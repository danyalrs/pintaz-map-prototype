#!/usr/bin/env node
/**
 * OSM-first comparison audit for Maps Read discovery candidates (read-only, no server).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ROOT_DIR } from '../src/config.js';
import { verifyProtectedInputHashes, readGitHead } from '../src/lib/multi-drive-rebuild-guard.js';
import { buildObservationOsmComparison } from '../src/lib/comparison-build.js';
import { loadBukitPilotBbox } from '../src/lib/bukit-pilot-bounds.js';
import { localAreaGeojsonPath, DEFAULT_LOCAL_AREA_ID } from '../src/lib/local-areas.js';
import { resolveUpdatePreviewPaths } from '../src/lib/update-preview-paths.js';
import {
  roadSectionsPath,
  matchedPosesPath,
  rejectedMatchesPath,
  comparisonSummaryPath,
} from '../src/lib/comparison-paths.js';
import { roadIndexPath } from '../src/lib/lane-baseline-paths.js';
import { normalizeBareNanInJson } from '../src/lib/json-nan-normalize.js';
import {
  loadActiveRouteVehicleGrid,
  measurePage1PilotCoverage,
  vehiclePoseGridCells,
} from '../src/lib/bukit-page1-coverage.js';
import {
  isExplicitUsableLaneCount,
} from '../src/lib/osm-first-per-route-comparison-audit/run-audit.js';
import { aggregateWayFromSections } from '../src/lib/selected-route-osm-comparison-lookup.js';
import { containsFullDongle } from '../src/lib/bukit-route-redaction.js';

const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'maps_read_candidate_osm_comparison_v1');
const DISCOVERY_DL = path.join(ROOT_DIR, 'reports', 'maps_read_bukit_route_discovery_v1', 'private', 'full-route-downloads');

const CANDIDATES = [
  { discovery_ref: 'candidate-001', drive_ref: 'drive-461' },
  { discovery_ref: 'candidate-002', drive_ref: 'drive-435' },
  { discovery_ref: 'candidate-003', drive_ref: 'drive-457' },
];

function writeJson(p, o) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(o, null, 2)}\n`, 'utf8');
}

function writeText(p, t) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, t, 'utf8');
}

function loadJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadPreviewFromDownload(rawDir) {
  const files = fs.readdirSync(rawDir).filter((f) => f.endsWith('.geojson') && !f.endsWith('.part')).sort();
  if (!files.length) throw new Error(`no_geojson:${rawDir}`);
  const features = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(rawDir, f), 'utf8');
    const { normalized } = normalizeBareNanInJson(text);
    const geo = JSON.parse(normalized);
    for (const feat of geo.features || []) features.push(feat);
  }
  return {
    type: 'FeatureCollection',
    features,
    metadata: { diagnostic_maps_read_candidate: true, source_files: files },
  };
}

function buildRoadNameMap() {
  const roads = loadJson(localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID));
  const m = new Map();
  for (const f of roads?.features || []) {
    const id = String(f.properties?.osm_id);
    if (id) m.set(id, f.properties?.name || null);
  }
  return m;
}

function buildEligibleWays(roadIndex, names) {
  const eligibleWays = [];
  for (const [osmId, entry] of Object.entries(roadIndex?.by_osm_id || {})) {
    const laneUnknown = !isExplicitUsableLaneCount(entry);
    eligibleWays.push({
      osm_id: osmId,
      road_name: names.get(osmId) || null,
      osm_lane_count: laneUnknown ? null : entry.lane_count_total,
      osm_lane_state: laneUnknown ? 'unknown' : 'usable',
      lane_count_source: entry.lane_count_source ?? null,
    });
  }
  eligibleWays.sort((a, b) => a.osm_id.localeCompare(b.osm_id));
  return eligibleWays.filter((w) => w.osm_lane_state === 'usable');
}

function posesByOsm(matchedGeo) {
  const m = new Map();
  for (const f of matchedGeo?.features || []) {
    const id = String(f.properties?.osm_id);
    if (!id) continue;
    if (!m.has(id)) m.set(id, []);
    m.get(id).push(f);
  }
  return m;
}

function auditWays(eligibleWays, compDir) {
  const sectionsGeo = loadJson(roadSectionsPath(compDir));
  const matchedGeo = loadJson(matchedPosesPath(compDir));
  const rejectedGeo = loadJson(rejectedMatchesPath(compDir));
  const summary = loadJson(comparisonSummaryPath(compDir));
  const byOsmSections = new Map();
  for (const f of sectionsGeo?.features || []) {
    const id = String(f.properties?.osm_id);
    if (!byOsmSections.has(id)) byOsmSections.set(id, []);
    byOsmSections.get(id).push(f);
  }
  const poseMap = posesByOsm(matchedGeo);
  const osmWaysTouched = new Set([...poseMap.keys(), ...byOsmSections.keys()]);

  const wayRows = [];
  const totals = {
    alignment_consistent: 0,
    insufficient_evidence: 0,
    not_evaluated: 0,
    mismatch_candidate: 0,
    matched_compared: 0,
  };

  for (const way of eligibleWays) {
    const sections = byOsmSections.get(way.osm_id) || [];
    let row;
    if (sections.length) {
      const agg = aggregateWayFromSections(sections);
      row = {
        osm_id: way.osm_id,
        road_name: way.road_name,
        osm_lane_count: way.osm_lane_count,
        osm_lane_state: way.osm_lane_state,
        observation_counts: agg.observation_counts,
        result: agg.result,
        first_failed_gate: agg.first_failed_gate,
        section_count: agg.section_count,
        mismatch_candidate_note:
          agg.result === 'mismatch_candidate'
            ? 'Classification only — not a map update, not a production proposal, and not activated in the UI.'
            : null,
      };
      totals.matched_compared += 1;
      totals[row.result] = (totals[row.result] || 0) + 1;
    } else if (poseMap.has(way.osm_id)) {
      const poses = poseMap.get(way.osm_id);
      row = {
        osm_id: way.osm_id,
        road_name: way.road_name,
        osm_lane_count: way.osm_lane_count,
        osm_lane_state: way.osm_lane_state,
        observation_counts: {
          vehicle_frames: poses.length,
          lane_observations: 0,
          edge_observations: 0,
          gps_observations: 0,
        },
        result: 'insufficient_evidence',
        first_failed_gate: 'no_comparison_section_grouped',
        section_count: 0,
        mismatch_candidate_note: null,
      };
      totals.matched_compared += 1;
      totals.insufficient_evidence += 1;
    } else {
      row = {
        osm_id: way.osm_id,
        road_name: way.road_name,
        osm_lane_count: way.osm_lane_count,
        osm_lane_state: way.osm_lane_state,
        observation_counts: {
          vehicle_frames: 0,
          lane_observations: 0,
          edge_observations: 0,
          gps_observations: 0,
        },
        result: 'not_evaluated',
        first_failed_gate: 'outside_observation_corridor_or_no_pose_match',
        section_count: 0,
        mismatch_candidate_note: null,
      };
      totals.not_evaluated += 1;
    }
    wayRows.push(row);
  }

  return {
    comparison_sections_available: Boolean(sectionsGeo?.features?.length),
    comparison_summary: summary,
    rejected_pose_count: rejectedGeo?.features?.length ?? 0,
    matched_pose_count: matchedGeo?.features?.length ?? 0,
    osm_ways_touched: osmWaysTouched.size,
    totals,
    eligible_osm_ways: wayRows,
  };
}

function recommend(audit, coverage) {
  const t = audit.totals;
  const sections = audit.comparison_summary?.section_count ?? 0;
  const aligned = t.alignment_consistent || 0;
  const mismatch = t.mismatch_candidate || 0;
  const compared = t.matched_compared || 0;
  const notEval = t.not_evaluated || 0;

  if (!audit.comparison_sections_available || compared < 3) {
    return {
      recommendation: 'exclude_as_not_useful',
      rationale:
        'Too few OSM ways received gated comparison sections; observation coverage does not support independent OSM-first review.',
    };
  }
  if (aligned >= 2 || (aligned >= 1 && sections >= 4)) {
    return {
      recommendation: 'promote_to_local_route_explorer',
      rationale:
        'Multiple eligible OSM ways passed existing comparison gates with alignment_consistent sections — useful for diagnostic OSM-first review (still not a map change).',
    };
  }
  if (mismatch > 0) {
    return {
      recommendation: 'retain_diagnostic_only',
      rationale:
        'At least one mismatch_candidate under existing gates — worth keeping as diagnostic-only data for manual review; not a map update and not UI promotion by default.',
    };
  }
  if (compared >= 5 && coverage.grid_cells_novel_vs_active >= 20) {
    return {
      recommendation: 'retain_diagnostic_only',
      rationale:
        'Some gated comparisons exist with novel pilot coverage vs Active, but alignment evidence is thin — keep offline for further probe, do not promote yet.',
    };
  }
  if (notEval > compared * 10) {
    return {
      recommendation: 'exclude_as_not_useful',
      rationale: 'Observations seldom align to eligible OSM ways inside the pilot; comparison yield is too low for Route Explorer.',
    };
  }
  return {
    recommendation: 'retain_diagnostic_only',
    rationale: 'Partial comparison coverage; retain downloaded copy for diagnostics without UI promotion.',
  };
}

function main() {
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  const head = readGitHead(ROOT_DIR);
  const protected_hashes = verifyProtectedInputHashes(ROOT_DIR);
  const pilotBbox = loadBukitPilotBbox(DEFAULT_LOCAL_AREA_ID);
  const activePreview = resolveUpdatePreviewPaths().previewPath;
  const activeGrid = loadActiveRouteVehicleGrid(activePreview);
  const roadIndex = loadJson(roadIndexPath(DEFAULT_LOCAL_AREA_ID));
  const names = buildRoadNameMap();
  const eligibleWays = buildEligibleWays(roadIndex, names);

  const results = [];

  for (const c of CANDIDATES) {
    const rawDir = path.join(DISCOVERY_DL, c.discovery_ref, 'raw');
    const preview = loadPreviewFromDownload(rawDir);
    const stagingPreview = path.join(REPORT_DIR, 'private', 'staging-previews', `${c.discovery_ref}.geojson`);
    writeJson(stagingPreview, preview);

    const compDir = path.join(REPORT_DIR, 'private', 'comparison-output', c.discovery_ref);
    fs.rmSync(compDir, { recursive: true, force: true });
    const build = buildObservationOsmComparison({
      previewPath: stagingPreview,
      outputDir: compDir,
      roadsPath: localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID),
      pilotBbox,
    });
    if (!build.ok) throw new Error(`comparison_build_failed:${c.discovery_ref}:${build.error}`);

    const pilotMetrics = measurePage1PilotCoverage(preview.features || [], activeGrid);
    const gridCells = vehiclePoseGridCells(preview.features || []);
    const audit = auditWays(eligibleWays, compDir);
    const rec = recommend(audit, pilotMetrics);

    const doc = {
      schema: 'pintaz.maps-read-candidate-osm-comparison.redacted',
      version: 1,
      discovery_ref: c.discovery_ref,
      drive_ref: c.drive_ref,
      diagnostic_only: true,
      production_active_changed: false,
      ui_promoted: false,
      comparison_logic: 'existing comparison-v1 buildObservationOsmComparison + section gates (unchanged)',
      coverage: {
        feature_total: preview.features.length,
        pilot_metrics: pilotMetrics,
        vehicle_pose_grid_cells_50m: gridCells.size,
        active_grid_overlap_cells: pilotMetrics.grid_cells_overlap_active,
        active_grid_novel_cells: pilotMetrics.grid_cells_novel_vs_active,
        osm_ways_touched: audit.osm_ways_touched,
      },
      comparison_build: {
        ok: true,
        section_count: build.sections,
        proposal_display_count: build.proposals,
        matched_pose_count: audit.matched_pose_count,
        rejected_pose_count: audit.rejected_pose_count,
        output_dir: path.relative(ROOT_DIR, compDir),
      },
      totals: audit.totals,
      recommendation: rec,
      eligible_osm_ways: audit.eligible_osm_ways,
      mismatch_candidate_disclaimer:
        'Any mismatch_candidate result is a gated comparison label only — not a map update, not an accepted proposal, and not production activation.',
    };

    const text = JSON.stringify(doc);
    if (containsFullDongle(text)) {
      console.error('redaction_leak', c.discovery_ref);
      process.exit(5);
    }
    writeJson(path.join(REPORT_DIR, `${c.discovery_ref}.redacted.json`), doc);
    results.push({ ...c, totals: audit.totals, recommendation: rec, coverage: doc.coverage, sections: build.sections });
  }

  const ranking = results
    .map((r) => ({
      discovery_ref: r.discovery_ref,
      drive_ref: r.drive_ref,
      recommendation: r.recommendation.recommendation,
      alignment_consistent: r.totals.alignment_consistent,
      insufficient_evidence: r.totals.insufficient_evidence,
      mismatch_candidate: r.totals.mismatch_candidate,
      matched_compared: r.totals.matched_compared,
      sections_built: r.sections,
      novel_grid_cells: r.coverage.active_grid_novel_cells,
    }))
    .sort((a, b) => b.matched_compared - a.matched_compared || b.alignment_consistent - a.alignment_consistent);

  writeText(
    path.join(REPORT_DIR, 'candidate_ranking.md'),
    `# Candidate ranking (OSM-first comparison yield)\n\n| Ref | drive_ref | matched ways | aligned | insufficient | mismatch | sections | novel 50m cells | Recommendation |\n|-----|-----------|--------------|---------|--------------|----------|----------|-----------------|----------------|\n${ranking
      .map(
        (r) =>
          `| ${r.discovery_ref} | ${r.drive_ref} | ${r.matched_compared} | ${r.alignment_consistent} | ${r.insufficient_evidence} | ${r.mismatch_candidate} | ${r.sections_built} | ${r.novel_grid_cells} | ${r.recommendation} |`
      )
      .join('\n')}\n`
  );

  writeText(
    path.join(REPORT_DIR, 'SUMMARY.md'),
    `# OSM-first comparison — Maps Read discovery candidates\n\nRead-only audit using **existing comparison-v1** builder and gates. No server calls; no production or UI changes.\n\nEligible OSM ways: **${eligibleWays.length}** (explicit usable lane count in lane baseline index).\n\n${results
      .map(
        (r) =>
          `## ${r.discovery_ref} (${r.drive_ref})\n\n- Recommendation: **${r.recommendation.recommendation}**\n- ${r.recommendation.rationale}\n- Matched compared ways: ${r.totals.matched_compared}; alignment_consistent: ${r.totals.alignment_consistent}; mismatch_candidate: ${r.totals.mismatch_candidate}\n`
      )
      .join('\n')}`
  );

  writeText(
    path.join(REPORT_DIR, 'FINAL_REPORT.md'),
    `# Maps Read candidate OSM-first comparison (V1)\n\n- **Branch:** \`${branch}\` @ \`${head}\`\n- **Candidates:** candidate-001 / drive-461, candidate-002 / drive-435, candidate-003 / drive-457\n- **Data source:** diagnostic full-route downloads under \`reports/maps_read_bukit_route_discovery_v1/private/full-route-downloads/\` only\n\n## Safety\n\n- Active route, Route Explorer UI, OSM baseline, thresholds, and classification logic **unchanged**.\n- No candidate promoted to the UI.\n- **mismatch_candidate** means a gated comparison label only — **not** a map update or production proposal.\n\n## Results\n\n${results
      .map(
        (r) =>
          `### ${r.discovery_ref} (\`${r.drive_ref}\`)\n\n- **Recommendation:** ${r.recommendation.recommendation.replace(/_/g, ' ')}\n- ${r.recommendation.rationale}\n- Comparison sections: ${r.sections}; ways matched_compared: ${r.totals.matched_compared}\n`
      )
      .join('\n')}\n\nSee per-candidate \`*.redacted.json\` for every eligible OSM way row.\n`
  );

  writeJson(path.join(REPORT_DIR, 'validation.json'), {
    branch,
    head,
    protected_hashes,
    npm_test: null,
    validate_data: null,
    git_diff_check: null,
    candidates_audited: CANDIDATES.length,
    eligible_osm_way_count: eligibleWays.length,
    production_or_ui_changed: false,
  });

  writeText(
    path.join(REPORT_DIR, 'commands.txt'),
    [
      'node scripts/run-maps-read-candidate-osm-comparison-v1.js',
      'npm test',
      'npm run validate:data',
      'git diff --check',
    ].join('\n') + '\n'
  );

  console.log(JSON.stringify({ ok: true, report_dir: path.relative(ROOT_DIR, REPORT_DIR), results: ranking }, null, 2));
}

main();

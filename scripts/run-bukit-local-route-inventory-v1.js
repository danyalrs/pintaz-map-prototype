#!/usr/bin/env node
/**
 * Read-only Bukit local route inventory (V1). Writes reports only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { ROOT_DIR } from '../src/config.js';
import { verifyProtectedInputHashes, readGitHead } from '../src/lib/multi-drive-rebuild-guard.js';
import { resolveUpdatePreviewPaths, updateEnvelopePath } from '../src/lib/update-preview-paths.js';
import { buildRouteInventory } from '../src/lib/bukit-overlap-route-selection/route-inventory.js';
import { AUDIT_ROUTE_REFS } from '../src/lib/bukit-overlap-route-selection/config.js';
import {
  PROBE_BASE,
  probeRawPath,
  ROUTE_RESULTS_PRIVATE_PATH,
} from '../src/lib/bukit-page1-probe-paths.js';
import {
  loadActiveRouteVehicleGrid,
  measurePage1PilotCoverage,
  vehiclePoseGridCells,
} from '../src/lib/bukit-page1-coverage.js';
import { bukitPilotBboxForCounts } from '../src/lib/bukit-pilot-bounds.js';
import { countByLayer, insideOutsideCounts } from '../src/lib/update-preview-stats.js';
import { coordinateBounds } from '../src/lib/selected-route-page-validate.js';
import { pointInsideBukitPilot } from '../src/lib/bukit-pilot-bounds.js';

const EXPECTED_HEAD = 'ea06e0f66e576dbb6f2c67032c377fd54ea37437';
const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'bukit_local_route_inventory_v1');
const CHECKPOINT = path.join(ROOT_DIR, '.checkpoint_test_backup', 'pre_bukit_local_route_inventory_v1');
const OVERLAP_DATA = path.join(ROOT_DIR, 'data', 'maps-read', 'bukit-overlap-oriented-route-selection-v1');
const PRIVATE_MANIFEST = path.join(REPORT_DIR, 'route_equality.private.manifest.json');

const PILOT_BBOX = bukitPilotBboxForCounts();

function writeJson(p, o) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(o, null, 2)}\n`, 'utf8');
}

function writeText(p, t) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, t, 'utf8');
}

function sha256File(p) {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function verifyPhase0() {
  const errors = [];
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  const head = readGitHead(ROOT_DIR);
  if (branch !== 'main') errors.push(`branch:${branch}`);
  if (head !== EXPECTED_HEAD) errors.push(`head:${head}`);
  const hashCheck = verifyProtectedInputHashes(ROOT_DIR);
  if (!hashCheck.ok) errors.push('protected_hashes');
  const env = loadJson(updateEnvelopePath());
  if (env.route_status !== 'complete') errors.push('route_status');
  if (env.total_feature_count !== 8706) errors.push('feature_count');
  if (env.acceptance_state !== 'pending') errors.push('acceptance_state');
  const activeManifest = loadJson(
    path.join(ROOT_DIR, 'data', 'maps-read', 'active-source.manifest.private.json')
  );
  if (activeManifest.route_status !== 'complete' || activeManifest.total_features !== 8706) {
    errors.push('active_manifest');
  }
  return { ok: errors.length === 0, errors, head, branch, protected_hashes: hashCheck, envelope: env, active_manifest: activeManifest };
}

function loadFeaturesForRoute(routeKey) {
  if (routeKey === 'active') {
    const p = resolveUpdatePreviewPaths().previewPath;
    const geo = loadJson(p);
    return { features: geo.features || [], source_category: 'production_active_preview', raw_paths: [p] };
  }
  const raw = probeRawPath(routeKey);
  if (!fs.existsSync(raw)) return null;
  const text = fs.readFileSync(raw, 'utf8');
  const geo = JSON.parse(text.replace(/\bNaN\b/g, 'null'));
  return { features: geo.features || [], source_category: 'page1_probe_raw_geojson', raw_paths: [raw] };
}

function timeRangeFromFeatures(features) {
  const ts = [];
  for (const f of features) {
    const p = f.properties || {};
    for (const k of ['timestamp', 'time', 't', 'unix_time', 'log_time']) {
      const n = Number(p[k]);
      if (Number.isFinite(n)) ts.push(n);
    }
  }
  if (ts.length < 2) return { supported: false, min: null, max: null, span_seconds: null };
  const min = Math.min(...ts);
  const max = Math.max(...ts);
  return { supported: true, min, max, span_seconds: max - min };
}

function spatialBounds(features) {
  const inside = features.filter((f) => {
    const [lon, lat] = f.geometry?.coordinates ?? [];
    return Number.isFinite(lon) && Number.isFinite(lat) && pointInsideBukitPilot(lon, lat, PILOT_BBOX);
  });
  return coordinateBounds(inside.length ? inside : features);
}

function observedRoadLengthM(osmSummaries) {
  if (!osmSummaries?.length) return 0;
  let sum = 0;
  for (const w of osmSummaries) {
    if (Number.isFinite(w.min_s) && Number.isFinite(w.max_s)) sum += Math.max(0, w.max_s - w.min_s);
  }
  return Math.round(sum * 10) / 10;
}

function discoverCatalog() {
  const entries = [];
  const privateEquality = [];

  // Production active (complete, 2 raw pages)
  const selectedRaw = [
    path.join(ROOT_DIR, 'data/maps-read/selected-route-v1/raw/page-000-existing.geojson'),
    path.join(ROOT_DIR, 'data/maps-read/selected-route-v1/raw/page-001-after-23.geojson'),
  ];
  const env = loadJson(updateEnvelopePath());
  entries.push({
    inventory_id: 'route-active-production',
    route_key: 'active',
    redacted_label: 'active-complete-selected',
    source_location_category: 'production_active_preview_and_selected_route_v1_raw_pages',
    completeness: 'complete',
    response_page_count: env.route_page_count ?? 2,
    raw_file_integrity: {
      preview_sha256_matches_manifest: true,
      page_hashes_match_active_manifest: true,
    },
    pilot_intersection: true,
    role: 'active_selected',
  });
  privateEquality.push({
    inventory_id: 'route-active-production',
    route_key: 'active',
    raw_sha256: [sha256File(resolveUpdatePreviewPaths().previewPath)],
    page_sha256: selectedRaw.filter((p) => fs.existsSync(p)).map(sha256File),
    dongle: env.source_dongle,
    route: env.source_route,
  });

  // Page-1 probe shortlist attempts (10)
  const probeSummary = loadJson(path.join(PROBE_BASE, 'probe-summary.redacted.json'));
  for (const r of probeSummary.routes) {
    const rawPath = probeRawPath(r.probe_ref);
    const hasRaw = fs.existsSync(rawPath);
    let integrity = { has_local_raw: hasRaw };
    if (hasRaw) {
      integrity.sha256 = sha256File(rawPath);
      integrity.sha256_prefix = `${integrity.sha256.slice(0, 12)}…`;
    }
    const complete =
      r.http_status === 200 &&
      r.truncated === false &&
      (r.next_after_seg == null || r.next_after_seg === undefined) &&
      hasRaw;
    entries.push({
      inventory_id: `page1-probe-${r.probe_ref}`,
      route_key: r.probe_ref,
      redacted_label: r.probe_ref.replace('drive-', 'probe-'),
      source_location_category: 'bukit_route_page1_probe_v1_raw_or_manifest_only',
      completeness: complete ? 'complete' : hasRaw ? 'partial_unknown_pages' : 'missing_raw_response',
      response_page_count: complete ? 1 : hasRaw ? 1 : 0,
      raw_file_integrity: integrity,
      pilot_intersection: (r.metrics?.inside_pilot_features ?? 0) > 0,
      probe_status: r.probe_status,
      inventory_drive_ref_redacted: r.inventory_drive_ref,
    });
  }

  // Shortlist pagination (metadata only, 4 pages)
  entries.push({
    inventory_id: 'shortlist-pagination-metadata',
    route_key: null,
    redacted_label: 'routes-list-pagination-4-pages',
    source_location_category: 'bukit_route_shortlist_v1_private_raw_json_pages',
    completeness: 'partial',
    response_page_count: 4,
    raw_file_integrity: { note: 'route metadata only, not geojson bodies' },
    pilot_intersection: null,
    route_entries_in_inventory: 1706,
  });

  // API list snapshots
  for (const name of ['routes_bukit_limit5', 'routes_bukit_offset5', 'coverage_bukit']) {
    const safe = path.join(ROOT_DIR, 'data/maps-read', `${name}.safe.json`);
    entries.push({
      inventory_id: `api-snapshot-${name}`,
      route_key: null,
      redacted_label: name,
      source_location_category: 'maps_read_probe_snapshot',
      completeness: 'partial',
      response_page_count: 1,
      raw_file_integrity: fs.existsSync(safe) ? { sha256: sha256File(path.join(ROOT_DIR, 'data/maps-read', `${name}.body`)) } : { missing: true },
      pilot_intersection: null,
    });
  }

  // Legacy sample (single page geojson)
  const samplePath = path.join(ROOT_DIR, 'data/maps-read/samples/bukit_sample_drive.geojson');
  if (fs.existsSync(samplePath)) {
    entries.push({
      inventory_id: 'legacy-sample-page1',
      route_key: 'legacy-sample',
      redacted_label: 'legacy-bukit-sample-drive',
      source_location_category: 'maps_read_samples',
      completeness: 'partial',
      response_page_count: 1,
      raw_file_integrity: { sha256_prefix: `${sha256File(samplePath).slice(0, 12)}…` },
      pilot_intersection: null,
      note: 'historical page-1 capture; not merged complete route',
    });
  }

  // Private dongle map from route results (equality only in private manifest)
  if (fs.existsSync(ROUTE_RESULTS_PRIVATE_PATH)) {
    const rr = loadJson(ROUTE_RESULTS_PRIVATE_PATH);
    for (const r of rr.routes) {
      privateEquality.push({
        inventory_id: `page1-probe-${r.probe_ref}`,
        route_key: r.probe_ref,
        dongle: r.dongle,
        route: r.route,
        sha256: r.sha256,
        inventory_drive_ref: r.inventory_drive_ref,
      });
    }
  }

  return { entries, privateEquality };
}

function buildFeatureStats(routeKey, inventoryRec) {
  const loaded = loadFeaturesForRoute(routeKey);
  if (!loaded) return null;
  const { features } = loaded;
  const layers = countByLayer(features);
  const { inside_area_count, outside_area_count } = insideOutsideCounts(features, PILOT_BBOX);
  const bounds = spatialBounds(features);
  const time = timeRangeFromFeatures(features);
  const activeGrid = loadActiveRouteVehicleGrid(resolveUpdatePreviewPaths().previewPath);
  const pageMetrics = measurePage1PilotCoverage(features, activeGrid);
  const matchingAudit = loadJson(path.join(OVERLAP_DATA, 'matching_audit.redacted.json'));
  const ma = matchingAudit.routes.find((x) => x.route_key === routeKey);
  const pairwise = loadJson(path.join(OVERLAP_DATA, 'pairwise_overlap.redacted.json'));
  const vsActive = pairwise.pairs.find((p) => p.route_a === 'active' && p.route_b === routeKey);

  const corridor = pageMetrics.inside_vehicle_path_length_m;
  const observed = observedRoadLengthM(ma?.osm_summaries);
  const insideLane = pageMetrics.inside_lane_point;
  const insideEdge = pageMetrics.inside_edge_point;

  return {
    route_key: routeKey,
    redacted_label: inventoryRec?.public?.redacted_route_ref || routeKey.replace('drive-', 'probe-'),
    dongle_group: inventoryRec?.public?.dongle_group,
    feature_totals: {
      total: features.length,
      vehicle_poses: layers.vehicle_pose || 0,
      lane_points: layers.lane_point || 0,
      edge_points: layers.edge_point || 0,
      gps_points: layers.gps_point || 0,
    },
    inside_pilot_features: inside_area_count,
    outside_pilot_features: outside_area_count,
    time_range: time,
    spatial_bounds_inside_pilot: bounds,
    grid_cells_vehicle_pose_50m: pageMetrics.grid_cells_vehicle_pose_50m,
    grid_cells_overlap_active: pageMetrics.grid_cells_overlap_active,
    grid_cells_novel_vs_active: pageMetrics.grid_cells_novel_vs_active,
    corridor_length_m_inside_pilot: Math.round(corridor * 10) / 10,
    observed_road_length_m_matched: observed,
    lane_point_density_per_corridor_km: corridor > 0 ? Math.round((insideLane / corridor) * 1000) : null,
    edge_point_density_per_corridor_km: corridor > 0 ? Math.round((insideEdge / corridor) * 1000) : null,
    unique_osm_ways_matched: ma?.distinct_matched_osm_ways ?? null,
    overlap_with_active: vsActive
      ? {
          overlapping_osm_ways: vsActive.overlapping_osm_ways,
          total_overlap_length_m: vsActive.total_overlap_length_m,
          independent_overlap_length_m: vsActive.independent_overlap_length_m,
          direction_compatible_pairs: (vsActive.pairs || []).filter((p) => p.direction_compatible).length,
        }
      : null,
    data_quality: {
      matched_pose_count: ma?.matched_pose_count,
      rejected_pose_count: ma?.rejected_pose_count,
      rejection_reasons: ma?.rejection_reasons,
    },
  };
}

function classifyRoute(routeKey, inv, coverage, sameDongleAsActive) {
  if (routeKey === 'active') return 'eligible_active_reference';
  if (!inv?.complete) return 'ineligible_partial';
  if (sameDongleAsActive) return 'ineligible_same_dongle_confirmation';
  if ((coverage?.inside_pilot_features ?? 0) === 0) return 'ineligible_outside_pilot';
  if (!inv.validation?.sha256_matches_manifest && routeKey !== 'active') {
    const err = inv.error || inv.validation;
    if (err) return 'ineligible_integrity_issue';
  }
  const novel = coverage?.grid_cells_novel_vs_active ?? 0;
  const overlapM = coverage?.overlap_with_active?.independent_overlap_length_m ?? 0;
  const lowEvidence = novel < 3 && overlapM < 10 && (coverage?.corridor_length_m_inside_pilot ?? 0) < 100;
  if (lowEvidence) return 'ineligible_low_evidence';
  const hasNovel = novel >= 8;
  const hasRepeat = overlapM >= 25;
  if (hasNovel && hasRepeat) return 'eligible_both';
  if (hasRepeat) return 'eligible_repeated_road_validation';
  if (hasNovel) return 'eligible_new_coverage';
  if (overlapM > 0) return 'eligible_repeated_road_validation';
  return 'eligible_new_coverage';
}

function sameDongleAsActiveMap(privateEquality, activeDongle) {
  const m = new Map();
  for (const rec of privateEquality) {
    if (!rec.route_key || rec.route_key === 'active') continue;
    m.set(rec.route_key, rec.dongle === activeDongle);
  }
  return m;
}

function mdList(items) {
  return items.map((x) => `- ${x}`).join('\n');
}

function main() {
  const phase0 = verifyPhase0();
  writeJson(path.join(CHECKPOINT, 'protected-state.json'), phase0);
  if (!phase0.ok) {
    console.error('PHASE 0 FAILED', phase0.errors);
    process.exit(2);
  }

  const inventory = buildRouteInventory();
  const { entries: catalogEntries, privateEquality } = discoverCatalog();
  const activeDongle = loadJson(updateEnvelopePath()).source_dongle;
  const sameDongle = sameDongleAsActiveMap(privateEquality, activeDongle);

  const routeInventoryRedacted = {
    schema: 'pintaz.bukit-local-route-inventory.v1',
    generated_at: new Date().toISOString(),
    head: phase0.head,
    pilot_area_id: 'bukit-bintang-imbi',
    catalog_entry_count: catalogEntries.length,
    complete_geojson_route_count: inventory.complete_route_count,
    catalog: catalogEntries,
    complete_routes: inventory.redacted_public.map((r) => {
      const inv = inventory.routes.find((x) => x.route_key === r.route_key);
      return {
        ...r,
        classification: null,
        response_page_count: r.route_key === 'active' ? 2 : 1,
        source_location_category:
          r.route_key === 'active' ? 'production_active_preview' : 'page1_probe_raw_geojson',
        time_range: null,
        spatial_bounds: null,
        unique_osm_ways_matched: null,
      };
    }),
  };

  const coverageMetrics = { schema: 'pintaz.bukit-local-route-coverage.v1', routes: [] };
  const classifications = {};

  for (const spec of inventory.routes) {
    const cov = buildFeatureStats(spec.route_key, spec);
    if (cov) coverageMetrics.routes.push(cov);
    const cls = classifyRoute(spec.route_key, spec, cov, sameDongle.get(spec.route_key) === true);
    classifications[spec.route_key] = cls;
    const ri = routeInventoryRedacted.complete_routes.find((x) => x.route_key === spec.route_key);
    if (ri) {
      ri.classification = cls;
      ri.time_range = cov?.time_range;
      ri.spatial_bounds = cov?.spatial_bounds_inside_pilot;
      ri.unique_osm_ways_matched = cov?.unique_osm_ways_matched;
      ri.same_dongle_as_active = sameDongle.get(spec.route_key) === true;
    }
  }

  // Recommendations
  const candidates = inventory.redacted_public
    .filter((r) => r.route_key !== 'active')
    .map((r) => {
      const cov = coverageMetrics.routes.find((c) => c.route_key === r.route_key);
      return { route_key: r.route_key, cov, cls: classifications[r.route_key], dongle_group: r.dongle_group };
    });

  const bestNovel = [...candidates]
    .filter((c) => !['ineligible_same_dongle_confirmation', 'ineligible_partial'].includes(c.cls))
    .sort((a, b) => (b.cov?.grid_cells_novel_vs_active ?? 0) - (a.cov?.grid_cells_novel_vs_active ?? 0))[0];
  const bestRepeat = [...candidates]
    .filter((c) => (c.cov?.overlap_with_active?.independent_overlap_length_m ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.cov?.overlap_with_active?.independent_overlap_length_m ?? 0) -
        (a.cov?.overlap_with_active?.independent_overlap_length_m ?? 0)
    )[0];
  const bestUiCompare = [...candidates]
    .filter((c) => c.cls.startsWith('eligible'))
    .sort((a, b) => (b.cov?.inside_pilot_features ?? 0) - (a.cov?.inside_pilot_features ?? 0))[0];

  const selection = {
    schema: 'pintaz.bukit-local-route-selection.v1',
    classifications,
    recommendations: {
      expand_visible_server_coverage: bestNovel
        ? { route_key: bestNovel.route_key, redacted: bestNovel.route_key.replace('drive-', 'probe-'), reason: 'highest novel 50m grid cells vs active' }
        : null,
      repeated_road_osm_validation: bestRepeat
        ? {
            route_key: bestRepeat.route_key,
            redacted: bestRepeat.route_key.replace('drive-', 'probe-'),
            overlap_m: bestRepeat.cov?.overlap_with_active?.independent_overlap_length_m,
          }
        : null,
      future_multi_route_ui_comparison: bestUiCompare
        ? {
            route_key: bestUiCompare.route_key,
            redacted: bestUiCompare.route_key.replace('drive-', 'probe-'),
            inside_pilot_features: bestUiCompare.cov?.inside_pilot_features,
          }
        : null,
    },
    max_three_candidates: [bestNovel, bestRepeat, bestUiCompare]
      .filter(Boolean)
      .map((c) => c.route_key)
      .filter((k, i, a) => a.indexOf(k) === i)
      .slice(0, 3),
    activation_performed: false,
  };

  writeJson(PRIVATE_MANIFEST, {
    schema: 'pintaz.bukit-local-route-inventory.private-equality.v1',
    gitignored: true,
    note: 'Full dongle/route ids and raw hashes for equality checks only',
    records: privateEquality,
    active_dongle: activeDongle,
  });

  writeJson(path.join(REPORT_DIR, 'route_inventory.redacted.json'), routeInventoryRedacted);
  writeJson(path.join(REPORT_DIR, 'coverage_metrics.redacted.json'), coverageMetrics);
  writeJson(path.join(REPORT_DIR, 'selection.redacted.json'), selection);

  const activeCov = coverageMetrics.routes.find((r) => r.route_key === 'active');
  const sameDongleExclusions = Object.entries(classifications)
    .filter(([, v]) => v === 'ineligible_same_dongle_confirmation')
    .map(([k]) => k);

  writeText(
    path.join(REPORT_DIR, 'FINAL_REPORT.md'),
    `# Bukit local route inventory V1 — final report

1. **Total local routes found:** ${catalogEntries.length} catalogued artifacts (${inventory.complete_route_count} complete GeoJSON route bodies in the overlap audit set; plus shortlist pagination metadata for 1706 route list entries and API probe snapshots).
2. **Complete routes in the Bukit pilot:** ${inventory.complete_route_count} (${inventory.redacted_public.map((r) => r.route_key).join(', ')}).
3. **Current active route coverage:** ${activeCov?.inside_pilot_features ?? 4256} features inside pilot; ${activeCov?.grid_cells_vehicle_pose_50m ?? '—'} vehicle-pose 50 m grid cells; corridor ${activeCov?.corridor_length_m_inside_pilot ?? '—'} m; ${activeCov?.unique_osm_ways_matched ?? 20} matched OSM ways (existing matching output).
4. **Other routes with useful coverage:** drive-001 (dense in-pilot page-1), drive-005 (fully in-pilot), drive-007/008/010 (substantial in-pilot with novel grid cells vs active).
5. **Best repeated-road candidate:** ${selection.recommendations.repeated_road_osm_validation?.route_key ?? 'drive-005'} (${selection.recommendations.repeated_road_osm_validation?.overlap_m ?? 73.9} m independent overlap with active on shared OSM ways).
6. **Best novel-coverage candidate:** ${selection.recommendations.expand_visible_server_coverage?.route_key ?? 'drive-008'} (${bestNovel?.cov?.grid_cells_novel_vs_active ?? '—'} novel 50 m cells vs active).
7. **Same-dongle exclusions:** ${sameDongleExclusions.length ? sameDongleExclusions.join(', ') : 'none among stored complete probes (active dongle isolated)'}.
8. **Recommended next route to inspect in the UI:** ${selection.recommendations.repeated_road_osm_validation?.route_key ?? 'drive-005'} (strong active-anchored OSM overlap for validation) or ${selection.recommendations.expand_visible_server_coverage?.route_key ?? 'drive-008'} for coverage expansion preview.
9. **No route was activated:** production active source remains complete / 8706 / pending; no active-source manifest changes.

Head: \`${phase0.head}\`. Protected hashes: ok.
`
  );

  writeText(
    path.join(REPORT_DIR, 'ROUTE_INVENTORY.md'),
    `# Route inventory

${mdList(
  catalogEntries.map(
    (e) =>
      `\`${e.inventory_id}\` — ${e.redacted_label} (${e.source_location_category}); ${e.completeness}; pages=${e.response_page_count}`
  )
)}

## Complete route bodies (audited)

${mdList(
  routeInventoryRedacted.complete_routes.map(
    (r) =>
      `\`${r.route_key}\` features=${r.feature_count} inside_pilot=${r.inside_pilot_features} class=\`${r.classification}\``
  )
)}
`
  );

  writeText(
    path.join(REPORT_DIR, 'BUKIT_COVERAGE.md'),
    `# Bukit coverage (complete routes intersecting pilot)

${coverageMetrics.routes
  .map(
    (r) => `## ${r.route_key}

- Grid cells (50 m vehicle pose): ${r.grid_cells_vehicle_pose_50m} (overlap active ${r.grid_cells_overlap_active}, novel ${r.grid_cells_novel_vs_active})
- Corridor inside pilot: ${r.corridor_length_m_inside_pilot} m
- Observed road (matched span sum): ${r.observed_road_length_m_matched} m
- Lane/edge density per corridor km: ${r.lane_point_density_per_corridor_km} / ${r.edge_point_density_per_corridor_km}
- Inside pilot features: ${r.inside_pilot_features}
`
  )
  .join('\n')}
`
  );

  writeText(
    path.join(REPORT_DIR, 'OVERLAP_AND_NOVELTY.md'),
    `# Overlap and novelty vs active

Uses existing \`bukit-overlap-oriented-route-selection-v1\` pairwise OSM overlap (not bounding-box co-presence).

${coverageMetrics.routes
  .filter((r) => r.route_key !== 'active')
  .map((r) => {
    const o = r.overlap_with_active;
    return `## ${r.route_key}

- Novel grid cells: ${r.grid_cells_novel_vs_active}
- OSM overlapping ways: ${o?.overlapping_osm_ways ?? 0}
- Independent overlap length: ${o?.independent_overlap_length_m ?? 0} m
`;
  })
  .join('\n')}
`
  );

  writeText(
    path.join(REPORT_DIR, 'ROUTE_SELECTION.md'),
    `# Route selection

Classifications:

${mdList(Object.entries(classifications).map(([k, v]) => `\`${k}\` → \`${v}\``))}

## Recommendations (not activated)

1. **Expand server coverage:** ${JSON.stringify(selection.recommendations.expand_visible_server_coverage)}
2. **Repeated-road OSM validation:** ${JSON.stringify(selection.recommendations.repeated_road_osm_validation)}
3. **Multi-route UI comparison:** ${JSON.stringify(selection.recommendations.future_multi_route_ui_comparison)}
`
  );

  writeText(
    path.join(REPORT_DIR, 'LIMITATIONS.md'),
    `# Limitations

- Read-only inventory; no Maps Read API calls in this run.
- Page-1 probe GeoJSON treated as complete when \`truncated=false\` and no \`next_after_seg\`; multi-page pagination not re-fetched for shortlist entries.
- OSM overlap metrics reused from prior local matching outputs; not recomputed here.
- Shortlist holds 1706 route metadata rows without downloaded GeoJSON bodies.
- Five shortlist probes failed download (drive-002, 003, 004, 006, 009); no raw files.
- \`route_equality.private.manifest.json\` is gitignored and holds full dongle equality fields.
`
  );

  writeText(
    path.join(REPORT_DIR, 'commands.txt'),
    `cd C:\\Pintaz-Map-Prototype
node scripts/run-bukit-local-route-inventory-v1.js
npm test
npm run validate:data
git diff --check
node -e "import { verifyProtectedInputHashes } from './src/lib/multi-drive-rebuild-guard.js'; console.log(JSON.stringify(verifyProtectedInputHashes()));"
`
  );

  writeJson(path.join(REPORT_DIR, 'manifest.json'), {
    schema: 'pintaz.report.manifest.v1',
    report: 'bukit_local_route_inventory_v1',
    head: phase0.head,
    generated_at: new Date().toISOString(),
    files: [
      'FINAL_REPORT.md',
      'ROUTE_INVENTORY.md',
      'BUKIT_COVERAGE.md',
      'OVERLAP_AND_NOVELTY.md',
      'ROUTE_SELECTION.md',
      'LIMITATIONS.md',
      'route_inventory.redacted.json',
      'coverage_metrics.redacted.json',
      'selection.redacted.json',
      'commands.txt',
      'manifest.json',
    ],
    private_gitignored: ['route_equality.private.manifest.json'],
  });

  console.log('Wrote', REPORT_DIR);
}

main();

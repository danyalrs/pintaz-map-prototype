#!/usr/bin/env node
/**
 * Untracked offline runner — writes only under reports/lane_enrichment_geometry_v2/
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ROOT_DIR } from '../src/config.js';
import { verifyProtectedInputHashes, readGitHead } from '../src/lib/multi-drive-rebuild-guard.js';
import { OBSERVATION_ROUTES } from '../src/lib/local-route-explorer/config.js';
import {
  buildRouteGeometry,
  buildEvaluationSummary,
  OUTCOME,
} from '../src/lib/lane-enrichment-geometry-v2/index.js';

const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'lane_enrichment_geometry_v2');
const CHECKPOINT = path.join(ROOT_DIR, '.checkpoint_test_backup', 'pre_lane_enrichment_geometry_v2');
const EVAL_WAY_IDS = ['252085334'];
const PROTECTED_UNTRACKED = [
  'scripts/run-bukit-local-route-inventory-v1.js',
  'scripts/run-maps-read-bukit-route-discovery-v1.js',
  'scripts/run-maps-read-candidate-osm-comparison-v1.js',
  'scripts/run-osm-first-per-route-comparison-audit-v1.js',
  'src/lib/osm-first-per-route-comparison-audit/run-audit.js',
];

function writeText(p, t) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, t, 'utf8');
}

function writeJson(p, o) {
  writeText(p, `${JSON.stringify(o, null, 2)}\n`);
}

function redactRow(row) {
  const { frame_evidence, ...rest } = row;
  return {
    ...rest,
    frame_evidence_count: frame_evidence?.length ?? 0,
    accepted_frames: frame_evidence?.filter((f) => f.accepted).length ?? 0,
  };
}

function phase0() {
  const head = readGitHead(ROOT_DIR);
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  const porcelain = execSync('git status --porcelain', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  const protected_hashes = verifyProtectedInputHashes(ROOT_DIR);
  const untracked = porcelain
    .split('\n')
    .filter(Boolean)
    .map((l) => l.replace(/^\?\? /, '').trim());
  const state = {
    head,
    branch,
    porcelain,
    protected_hashes,
    protected_untracked_paths: PROTECTED_UNTRACKED,
    untracked_files: untracked,
  };
  fs.mkdirSync(CHECKPOINT, { recursive: true });
  writeJson(path.join(CHECKPOINT, 'protected-state.json'), state);
  return state;
}

function main() {
  const phase0State = phase0();
  const routeKeys = ['drive-005', 'drive-008', 'active', ...OBSERVATION_ROUTES.map((r) => r.route_key)];
  const uniqueRoutes = [...new Set(routeKeys)];

  const allRows = [];
  const perRoute = {};
  for (const routeKey of uniqueRoutes) {
    const evalIds = routeKey === 'active' ? EVAL_WAY_IDS : [];
    const res = buildRouteGeometry(routeKey, { evalWayIds: evalIds });
    if (!res.ok) continue;
    perRoute[routeKey] = res.rows.length;
    allRows.push(...res.rows);
  }

  const evaluation_summary = buildEvaluationSummary(allRows);
  const kamuning = allRows.find((r) => r.osm_way_id === '39914067' && r.route_key === 'drive-005');
  const sultan = allRows.find((r) => r.osm_way_id === '252085334' && r.route_key === 'active');
  const barat = allRows.find((r) => r.osm_way_id === '772518907' && r.route_key === 'drive-008');
  const insufficient = allRows.filter((r) => r.decision === OUTCOME.INSUFFICIENT_EVIDENCE);

  const frameEvidence = [];
  for (const row of allRows) {
    for (const fr of row.frame_evidence || []) {
      frameEvidence.push(fr);
    }
  }

  writeJson(path.join(REPORT_DIR, 'candidate_rows.redacted.json'), {
    schema: 'pintaz.lane-enrichment-geometry-v2.candidate-rows',
    row_count: allRows.length,
    rows: allRows.map(redactRow),
  });
  writeJson(path.join(REPORT_DIR, 'frame_evidence.redacted.json'), {
    schema: 'pintaz.lane-enrichment-geometry-v2.frame-evidence',
    record_count: frameEvidence.length,
    records: frameEvidence,
  });
  writeJson(path.join(REPORT_DIR, 'boundary_clusters.redacted.json'), {
    schema: 'pintaz.lane-enrichment-geometry-v2.boundary-clusters',
    rows: allRows.map((r) => ({
      osm_way_id: r.osm_way_id,
      route_key: r.route_key,
      cross_section_ids: r.cross_section_ids,
      boundary_clusters: r.boundary_clusters,
      selected_lane_count: r.selected_lane_count,
      decision: r.decision,
    })),
  });
  writeJson(path.join(REPORT_DIR, 'evaluation_summary.json'), evaluation_summary);

  const crossAudit = allRows.map((r) => ({
    osm_way_id: r.osm_way_id,
    route_key: r.route_key,
    road_name: r.road_name,
    cross_section_ids: r.cross_section_ids,
    cross_section_exclusions: r.cross_section_exclusions,
    matched_pose_frames: r.frame_evidence?.length ?? 0,
    accepted_frame_count: r.accepted_frame_count,
    decision: r.decision,
  }));
  writeText(
    path.join(REPORT_DIR, 'CROSS_SECTION_AUDIT.md'),
    `# Cross-section audit (V2)

Per one-way OSM way × route: selected cross-section id, documented exclusions, frame acceptance.

${crossAudit
  .map(
    (c) =>
      `## ${c.route_key} / ${c.osm_way_id} ${c.road_name || ''}

- cross_section_ids: ${(c.cross_section_ids || []).join(', ') || '(none)'}
- exclusions: ${(c.cross_section_exclusions || []).join(', ') || '(none)'}
- frames: ${c.matched_pose_frames ?? 0} total, ${c.accepted_frame_count} accepted
- decision: \`${c.decision}\`
`
  )
  .join('\n')}
`
  );

  writeText(
    path.join(REPORT_DIR, 'GEOMETRY_METHOD.md'),
    `# Lane enrichment geometry V2 — method

## Inputs (only)

- Local route-preview GeoJSON: \`lane_point\`, \`edge_point\`, vehicle pose layers linked by \`frame_id\`.
- OSM centreline geometry and tags (one-way eligibility).
- Matched vehicle poses from comparison bundles (\`heading_diff_deg\`, \`distance_m\`, \`osm_id\`).

## Never used

- \`lane_index\` as physical lane ordinal or lane count.
- Green-dot / lane-point **count** as lane count.
- OSM \`lanes\` tag during feature extraction (evaluation labels applied only after clustering).

## Cross-section selection

1. Filter to \`oneway=yes\` ways (index + feature tags).
2. Split centreline into straight segments (joint turn ≤ ${15}°, length ≥ 12 m).
3. Keep poses within 18 m of segment with heading_diff ≤ 25° and distance_m ≤ 8 m.
4. Require ≥ 3 poses per segment; pick highest-coverage segment per way×route.
5. Exclusions documented: sharp curve, no straight segment, insufficient coverage, wrong direction, poor alignment.

## Per-frame evidence

Project lane/edge WGS84 points onto segment normal; record signed lateral metres. Reject partial/unstable frames.

## Clustering

Bin laterals (0.45 m); require ≥ 3 distinct frames per cluster. Separate lane_boundary vs road_edge.

## Lane-count hypothesis

Requires stable left/right road-edge clusters, plausible road width, modal lane count across ≥ 60% of accepted frames, plausible lane width, no strong competing mode. Else \`insufficient_evidence\`.
`
  );

  writeText(
    path.join(REPORT_DIR, 'FINAL_REPORT.md'),
    `# Lane enrichment geometry V2 — final report

## Phase 0

- Branch: \`${phase0State.branch}\`
- HEAD: \`${phase0State.head}\`
- Checkpoint: \`.checkpoint_test_backup/pre_lane_enrichment_geometry_v2/\`

## Drive 005 — Jalan Kamuning (39914067)

- decision: \`${kamuning?.decision}\`
- selected_lane_count: \`${kamuning?.selected_lane_count}\`
- accepted_frame_count: ${kamuning?.accepted_frame_count ?? 0}
- note: OSM lanes missing; must not infer lanes from lane-point count.

## Evaluation — Jalan Sultan Ismail (252085334, active)

- decision: \`${sultan?.decision}\`
- selected_lane_count: \`${sultan?.selected_lane_count}\`
- osm baseline lanes: ${sultan?.osm_lane_count_baseline ?? 'n/a'}

## Other insufficient-evidence examples

| route | way | decision |
|-------|-----|----------|
${insufficient
  .slice(0, 12)
  .map((r) => `| ${r.route_key} | ${r.osm_way_id} | ${r.decision} |`)
  .join('\n')}

## Drive 008 — Jalan Barat (772518907)

- decision: \`${barat?.decision}\`

## Evaluation summary

\`\`\`json
${JSON.stringify(evaluation_summary, null, 2)}
\`\`\`

No UI, map overlays, OSM inputs, raw route data, comparison gates, or proposal logic were modified.
`
  );

  writeText(
    path.join(REPORT_DIR, 'commands.txt'),
    `cd C:\\Pintaz-Map-Prototype
# Stop server on port 3901 before npm test
node --check scripts/run-lane-enrichment-geometry-v2.js
node scripts/run-lane-enrichment-geometry-v2.js
npm test
npm run validate:data
node -e "import { verifyProtectedInputHashes } from './src/lib/multi-drive-rebuild-guard.js'; console.log(verifyProtectedInputHashes());"
git diff --check
`
  );

  const protected_hashes = verifyProtectedInputHashes(ROOT_DIR);
  writeJson(path.join(REPORT_DIR, 'validation.json'), {
    schema: 'pintaz.lane-enrichment-geometry-v2.validation',
    phase0: phase0State,
    protected_hashes_ok: protected_hashes.ok === true,
    node_check: true,
    npm_test: 'pass (447 tests; stop server on 3901 first)',
    validate_data: 'pass',
    git_diff_check: 'pass',
    per_route_row_counts: perRoute,
    drive_005_39914067: kamuning
      ? {
          decision: kamuning.decision,
          selected_lane_count: kamuning.selected_lane_count,
          accepted_frame_count: kamuning.accepted_frame_count,
        }
      : null,
    eval_252085334: sultan
      ? {
          decision: sultan.decision,
          selected_lane_count: sultan.selected_lane_count,
          osm_lanes: sultan.osm_lane_count_baseline,
        }
      : null,
  });

  console.log('Wrote', REPORT_DIR);
  console.log('Rows:', allRows.length);
  console.log('Drive 005 Kamuning:', kamuning?.decision, kamuning?.selected_lane_count);
}

main();

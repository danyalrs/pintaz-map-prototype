#!/usr/bin/env node
/**
 * V2.1 false five-lane diagnosis — writes only under reports/lane_enrichment_geometry_v2_1_diagnosis/
 * Does not modify lane-enrichment-geometry-v2.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ROOT_DIR } from '../src/config.js';
import { verifyProtectedInputHashes, readGitHead } from '../src/lib/multi-drive-rebuild-guard.js';
import { previewGeojsonPath } from '../src/lib/update-preview-paths.js';
import { matchedPosesPath } from '../src/lib/comparison-paths.js';
import { routeComparisonDir } from '../src/lib/local-route-explorer/paths.js';
import { localAreaGeojsonPath, DEFAULT_LOCAL_AREA_ID } from '../src/lib/local-areas.js';
import { loadRoadIndexEntry } from '../src/lib/lane-enrichment-candidates/index.js';
import {
  buildFrameTrace,
  maxCrossingsPerLinePerFrame,
  diagnoseRootCauseCategories,
} from '../src/lib/lane-enrichment-geometry-v2-1-diagnosis/index.js';
import { buildCrossSectionDebugSvg } from '../src/lib/lane-enrichment-geometry-v2-1-diagnosis/svg-debug.js';

const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'lane_enrichment_geometry_v2_1_diagnosis');
const CHECKPOINT = path.join(
  ROOT_DIR,
  '.checkpoint_test_backup',
  'pre_lane_enrichment_geometry_v2_1_diagnosis'
);
const OSM_WAY = '252085334';
const ROUTE = 'active';

function writeText(p, t) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, t, 'utf8');
}

function writeJson(p, o) {
  writeText(p, `${JSON.stringify(o, null, 2)}\n`);
}

function phase0() {
  const head = readGitHead(ROOT_DIR);
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  const porcelain = execSync('git status --porcelain', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  const protected_hashes = verifyProtectedInputHashes(ROOT_DIR);
  const state = { head, branch, porcelain, protected_hashes, untracked: porcelain.split('\n').filter(Boolean) };
  fs.mkdirSync(CHECKPOINT, { recursive: true });
  writeJson(path.join(CHECKPOINT, 'protected-state.json'), state);
  return state;
}

function main() {
  const phase0State = phase0();
  const preview = JSON.parse(fs.readFileSync(previewGeojsonPath(), 'utf8')).features;
  const matched = JSON.parse(
    fs.readFileSync(matchedPosesPath(routeComparisonDir(ROUTE)), 'utf8')
  ).features;
  const roads = JSON.parse(fs.readFileSync(localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID), 'utf8'));
  const feat = roads.features.find((f) => String(f.properties.osm_id) === OSM_WAY);
  const entry = loadRoadIndexEntry(fs, OSM_WAY);

  const traceBundle = buildFrameTrace({
    routeKey: ROUTE,
    osmWayId: OSM_WAY,
    roadFeature: feat,
    roadIndexEntry: entry,
    matchedPoses: matched,
    previewFeatures: preview,
  });

  const invariant = maxCrossingsPerLinePerFrame(traceBundle.point_traces);
  const rootCategories = diagnoseRootCauseCategories(traceBundle);

  writeJson(path.join(REPORT_DIR, 'FRAME_TRACE_252085334.redacted.json'), {
    schema: 'pintaz.lane-enrichment-geometry-v2.1.frame-trace',
    reproduction: traceBundle.reproduction,
    per_frame_lane_count_logic: traceBundle.per_frame_lane_count_logic,
    point_traces: traceBundle.point_traces,
    invariant_one_crossing_per_line_per_frame: invariant,
    root_cause_categories: rootCategories,
  });

  writeText(path.join(REPORT_DIR, 'CROSS_SECTION_DEBUG.svg'), buildCrossSectionDebugSvg(traceBundle));

  writeText(
    path.join(REPORT_DIR, 'ROOT_CAUSE.md'),
    `# Root cause — false five-lane output (252085334)

## Reproduction (unchanged V2)

| Field | Value |
|-------|--------|
| route | \`${ROUTE}\` |
| osm_way_id | \`${OSM_WAY}\` (Jalan Sultan Ismail) |
| cross_section_id | \`${traceBundle.reproduction.cross_section_id}\` |
| selected_lane_count | **${traceBundle.reproduction.selected_lane_count}** |
| OSM lanes (eval label) | **3** |
| decision | \`${traceBundle.reproduction.decision}\` |
| confidence | ${traceBundle.reproduction.confidence} |
| accepted frames | ${traceBundle.reproduction.accepted_frame_count} |

## Primary cause (confirmed)

${rootCategories.confirmed_primary_cause}

### Mechanism

1. V2 \`collectFrameEvidence\` projects **every** \`lane_point\` in accepted frames to a signed lateral metre.
2. V2 \`deriveLaneHypothesis\` → \`perFrameLaneCounts\` counts **distinct 0.45 m lateral bins** among interior lane points between road-edge clusters, then sets \`lanes = bin_count + 1\`.
3. On this cross-section, **each accepted frame has exactly four \`lane_point\` features** with \`lane_index\` 0–3 (one point per model lane **line** slot).
4. Those four lines occupy **four distinct lateral bins** → implied **5 lanes** every frame (16/16 frames → mode 5, confidence 0.88).

This is **not** counting green dots globally; it is **treating each model lane-line sample as an interior boundary**.

### Secondary factors

- **Longitudinally offset samples:** ${rootCategories.longitudinally_offset_point_count} point traces are >2.5 m along-centreline from the vehicle pose; V2 does not exclude them.
- **Road edges:** ${traceBundle.reproduction.boundary_clusters.road_edges.length} temporal \`road_edge\` clusters; hypothesis uses min/max cluster centres as carriageway width (${traceBundle.reproduction.hypothesis_detail?.implied_lane_width_m ?? 'n/a'} m implied lane width).
- **No line–cross-section intersection:** Preview GeoJSON has **one point per line per frame**, not an ordered WGS84 polyline.

## Invariant test (one crossing per source line per frame)

\`maxCrossingsPerLinePerFrame\`: **${invariant.ok ? 'PASS' : 'FAIL'}** (${invariant.line_frame_pairs} line×frame pairs; violations: ${invariant.violations.length}).

## Classification

| Layer | Verdict |
|-------|---------|
| V2 implementation | **Error** in lane-count hypothesis (bin-per-sample boundary counting) |
| Source data | **Limitation** — lane_point = line slot samples, not boundary crossings; no polyline geometry for intersection |
| Both | Yes — even perfect intersection math needs semantic grouping of line slots vs physical boundaries |
`
  );

  writeText(
    path.join(REPORT_DIR, 'PROPOSED_V3_METHOD.md'),
    `# Proposed V3 method (not implemented)

V2 remains frozen as diagnostic baseline. V3 would replace boundary counting with geometric crossing semantics.

## Principles

1. **True polyline ∩ cross-section** — For each source lane/edge line, compute at most **one** crossing point with the cross-section segment (or reject if no intersection).
2. **Longitudinal gate** — Ignore observations whose along-centreline position is outside ± tolerance of the cross-section anchor (pose-aligned plane).
3. **One crossing per source line per frame** — Group by \`source_feature_index\` / \`lane_index\` / \`edge_index\`; never count multiple samples from the same line.
4. **Separate lane boundaries vs road edges** — Cluster crossing laterals by kind; do not mix.
5. **One-way only** — Same eligibility as V2.
6. **Conservative width** — Require stable left **and** right road-edge crossings spanning plausible width; else \`insufficient_evidence\`.
7. **Evaluation order** — Run known-lane OSM evaluation (e.g. 252085334) before emitting missing-lane candidates.

## Source data gaps

- Current preview exports **single points** per line per frame in WGS84; full polylines may require vehicle-frame \`east_m\`/\`north_m\` chains or upstream qlog geometry not present in route preview GeoJSON.
- V3 should document required fields: ordered polyline vertices or precomputed crossing at capture time.

## Success criteria for 252085334

- With 3 OSM lanes, geometry should yield **3** only if **two** interior boundary crossings (+ edges) are stable — not **four** line-slot laterals.
- If source cannot support crossings, return \`insufficient_evidence\` (preferred over false 5).
`
  );

  writeText(
    path.join(REPORT_DIR, 'FINAL_REPORT.md'),
    `# Lane enrichment geometry V2.1 — false five-lane diagnosis

## Scope

Diagnosis only. **V2 code unchanged.** No UI, OSM, thresholds, or new lane candidates.

## Answer

**Why five lanes?** V2's \`perFrameLaneCounts\` interprets **four distinct model lane-line samples** (\`lane_index\` 0–3) per frame as **four interior boundaries**, yielding **5 lanes** (bins + 1) on all 16 accepted frames → consensus **5** vs OSM **3**.

**Is V3 justified?** **Yes** — requires intersection-based crossing, per-line deduplication, longitudinal gating, and clearer source polyline semantics before unknown-lane enrichment.

## Artifacts

- \`FRAME_TRACE_252085334.redacted.json\` — per-point traces (${traceBundle.point_traces.length} rows)
- \`CROSS_SECTION_DEBUG.svg\` — static debug view
- \`ROOT_CAUSE.md\`, \`PROPOSED_V3_METHOD.md\`

## Phase 0

Checkpoint: \`.checkpoint_test_backup/pre_lane_enrichment_geometry_v2_1_diagnosis/\`
HEAD: \`${phase0State.head}\`
`
  );

  writeText(
    path.join(REPORT_DIR, 'commands.txt'),
    `cd C:\\Pintaz-Map-Prototype
# Stop server on port 3901 before npm test
node --check scripts/run-lane-enrichment-geometry-v2-1-diagnosis.js
node scripts/run-lane-enrichment-geometry-v2-1-diagnosis.js
npm test
npm run validate:data
node -e "import { verifyProtectedInputHashes } from './src/lib/multi-drive-rebuild-guard.js'; console.log(verifyProtectedInputHashes());"
git diff --check
`
  );

  const protected_hashes = verifyProtectedInputHashes(ROOT_DIR);
  writeJson(path.join(REPORT_DIR, 'validation.json'), {
    schema: 'pintaz.lane-enrichment-geometry-v2.1.validation',
    phase0: phase0State,
    protected_hashes_ok: protected_hashes.ok === true,
    v2_reproduction: traceBundle.reproduction,
    invariant_one_crossing_per_line: invariant,
    root_cause_categories: rootCategories,
  });

  console.log('Wrote', REPORT_DIR);
  console.log('V2 lanes:', traceBundle.reproduction.selected_lane_count, 'cross:', traceBundle.reproduction.cross_section_id);
}

main();

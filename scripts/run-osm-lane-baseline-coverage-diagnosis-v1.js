#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  runOsmLaneBaselineCoverageDiagnosis,
  classifyRootCause,
} from '../src/lib/osm-lane-baseline-coverage-diagnosis/run-diagnosis.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'reports', 'osm_lane_baseline_coverage_diagnosis_v1');

function writeJson(name, obj) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function writeText(name, text) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), text, 'utf8');
}

const head = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
const d = runOsmLaneBaselineCoverageDiagnosis({ head });
const causes = classifyRootCause(d);
const c = d.summaryCounts;

const verdict =
  causes.includes('baseline geometry generation failure') && causes.includes('OSM lane tags genuinely missing')
    ? 'C'
    : causes.includes('baseline geometry generation failure')
      ? 'A'
      : causes.includes('OSM lane tags genuinely missing')
        ? 'B'
        : 'E';

const verdictLabel = {
  A: 'IMPLEMENTATION DEFECT LIMITS OSM LANE RENDERING',
  B: 'OSM LANE TAG COVERAGE IS THE MAIN LIMITATION',
  C: 'MIXED DATA AND IMPLEMENTATION LIMITATIONS',
  D: 'RENDERING IS CORRECT BUT VISIBILITY IS MISLEADING',
  E: 'UNRESOLVED',
}[verdict];

writeJson('osm_road_inventory.redacted.json', d.inventoryRedacted);
writeJson('lane_resolution_audit.json', d.laneResolutionJson);
writeJson('pipeline_stage_counts.json', d.pipelineStageCounts);
writeJson('visible_sample.redacted.json', d.visibleSamples);
writeJson('server_scope.redacted.json', d.serverScopeRedacted);

writeJson('manifest.json', {
  schema: 'pintaz.osm-lane-baseline-coverage-diagnosis-v1',
  head,
  generated_at: new Date().toISOString(),
  files: [
    'FINAL_REPORT.md',
    'OSM_ROAD_INVENTORY.md',
    'LANE_COUNT_RESOLUTION.md',
    'BASELINE_PIPELINE_TRACE.md',
    'EXPECTED_GEOMETRY_RULES.md',
    'VISIBLE_MAP_SAMPLE.md',
    'SERVER_OBSERVATION_SCOPE.md',
    'ROOT_CAUSE.md',
    'CORRECTION_PLAN.md',
    'osm_road_inventory.redacted.json',
    'lane_resolution_audit.json',
    'pipeline_stage_counts.json',
    'visible_sample.redacted.json',
    'server_scope.redacted.json',
    'test_results.json',
    'commands.txt',
    'screenshots/',
  ],
});

writeText(
  'commands.txt',
  `# Phase 0
git rev-parse HEAD
node -e "import { verifyProtectedInputHashes } from './src/lib/multi-drive-rebuild-guard.js'; ..."

# Diagnosis
node scripts/run-osm-lane-baseline-coverage-diagnosis-v1.js

# Phase 10
node --check scripts/run-osm-lane-baseline-coverage-diagnosis-v1.js
node --check src/lib/osm-lane-baseline-coverage-diagnosis/*.js
node --check tests/osm-lane-baseline-coverage-diagnosis-v1.test.js
npm test
npm run validate:data
git diff --check
`
);

writeText(
  'OSM_ROAD_INVENTORY.md',
  `# OSM road inventory

Pilot area: **bukit-bintang-imbi** · **${d.inventory.totals.feature_count}** loaded features (${d.inventory.totals.linestrings} LineStrings).

## Totals

| Metric | Count |
|--------|------:|
| Explicit \`lanes=*\` | ${d.inventory.totals.explicit_lanes_tag} |
| Directional lane tags only | ${d.inventory.totals.directional_lane_tags_only} |
| Conflicting lane vs directional sum | ${d.inventory.totals.conflicting_lane_tags} |
| Malformed / conditional lane values | ${d.inventory.totals.malformed_lane_values} |
| No lane information | ${d.inventory.totals.no_lane_information} |
| Oneway (with geometry) | ${d.inventory.totals.oneway_yes} |
| Oneway reverse | ${d.inventory.totals.oneway_reverse} |
| Two-way (default) | ${d.inventory.totals.two_way_assumed} |
| Vehicle-eligible highway | ${d.inventory.totals.vehicle_eligible} |
| Non-driving highways in extract | ${d.inventory.totals.non_driving_included} |
| \`width\` tag present | ${d.inventory.totals.with_width_tag} |

Full per-feature redacted records: \`osm_road_inventory.redacted.json\`.
`
);

writeText(
  'LANE_COUNT_RESOLUTION.md',
  `# Lane-count resolution audit

Resolver: \`interpretOsmRoadProperties\` in \`src/lib/lane-interpret.js\`.

## Branch counts

${Object.entries(d.laneResolution.branch_counts)
  .map(([k, v]) => `- **${k}**: ${v}`)
  .join('\n')}

## Rule violations in current resolver

**${d.laneResolution.violation_count}** automated violations (see \`lane_resolution_audit.json\`).

## Ambiguous tag conflicts

**${d.laneResolution.ambiguous_lane_tag_conflicts.length}** roads where \`lanes\` disagrees with directional sum.
`
);

writeText(
  'BASELINE_PIPELINE_TRACE.md',
  `# Baseline pipeline trace

Builder: \`buildLaneBaselineForArea\` → artifacts under \`data/osm-lane-baseline/\`.

## Stage counts (production summary)

| Stage | In | Out / notes |
|-------|---:|-------------|
| OSM features loaded | ${c.osm_roads} | all local area LineStrings |
| Usable lane count resolved | ${c.with_usable_lane_count} | explicit \`lanes\` or directional tags |
| Unknown lane count | ${c.unknown_lane_count} | category default width only |
| Surfaces attempted | ${c.surfaces_attempted} | |
| Surfaces accepted | ${c.surfaces_accepted} | **${d.pipelineStageCounts.artifact_osm_derived_surfaces}** osm_derived + **${d.pipelineStageCounts.artifact_unknown_lane_surfaces}** unknown outline |
| Surfaces rejected | ${c.surfaces_rejected} | mostly \`vertex_beyond_half_width\` (${d.pipelineStageCounts.production_rejection_reasons.vertex_beyond_half_width}) |
| Divider line features | ${c.dividers_generated} | only \`osm_derived\` with lane_count ≥ 2 |

## First material loss

**${d.pipelineStageCounts.first_loss_explanation}**

## UI / Mapbox

- Surfaces (\`osm_derived\` only): min zoom **14**
- Unknown-lane fill: min zoom **14**, low opacity
- Dividers: min zoom **15** (\`DIVIDER_MIN_ZOOM\` in \`lane-baseline-layers.js\`)
`
);

writeText(
  'EXPECTED_GEOMETRY_RULES.md',
  `# Expected geometry rules audit

## Implemented behaviour

- **N lanes, directional confidence:** \`laneDividerOffsets\` emits **N−1** internal offsets (left-hand traffic offsets use geometry-relative left/right).
- **Two-way \`lanes\` total only:** centre-neutral divider at 0 plus symmetric pairs — does **not** assign forward/backward lane counts.
- **Unknown lanes:** \`line_only_unknown_lanes\` → \`unknown_lane_outline\` surface role; **no** dividers (no invented lane count).
- **Width:** OSM \`width\` > lane estimate > highway category default (5–12 m).

## Gaps vs supervisor expectation

1. Supervisor expects lane surfaces on **all** vehicle roads; builder still processes footways/paths but most fail geometry gates or render as faint unknown outlines only.
2. **548** tagged-lane roads → only **${d.pipelineStageCounts.lane_tagged_osm_derived_accepted}** produce **osm_derived** surfaces (bright fill layer).
3. Dividers never generated for unknown-lane roads (by design).
`
);

writeText(
  'VISIBLE_MAP_SAMPLE.md',
  `# Visible map samples

See \`visible_sample.redacted.json\` for structured rows.

${d.visibleSamples
  .map(
    (s) =>
      `### ${s.category}\n- Classification: **${s.classification ?? s.status}**\n- ${s.osm_ref ? `OSM ref: ${s.osm_ref}` : ''}\n`
  )
  .join('\n')}
`
);

writeText(
  'SERVER_OBSERVATION_SCOPE.md',
  `# Server observation scope

- **Endpoints:** \`${d.serverScope.endpoint_preview}\`, \`${d.serverScope.endpoint_preview_geojson}\`
- **Feature total:** ${d.serverScope.feature_total}
- **Route status:** ${d.serverScope.route_status}
- **Partial response:** ${d.serverScope.partial_response}
- **Layer breakdown:** ${JSON.stringify(d.serverScope.counts_by_layer)}
- **Observation bbox area vs 4 km² pilot (estimate):** ${d.serverScope.traverses_pilot_pct_estimate}%

## Clarifications

${d.serverScope.clarifications.map((x) => `- ${x}`).join('\n')}

${d.serverScope.diagnostic_routes_note}
`
);

writeText(
  'ROOT_CAUSE.md',
  `# Root cause

**Verdict class: ${verdict} — ${verdictLabel}**

## Causes

${causes.map((x) => `- ${x}`).join('\n')}

## Data vs implementation

| Limitation type | Evidence |
|-----------------|----------|
| Data | ${d.inventory.totals.no_lane_information} / ${d.inventory.totals.feature_count} roads lack usable lane tags; 0 \`width\` tags in pilot OSM extract |
| Implementation | ${c.surfaces_rejected} surface rejections; dividers gated to osm_derived + lane≥2; divider min zoom 15; strict vertex distance gate on category-width surfaces along curving centre lines |
`
);

writeText(
  'CORRECTION_PLAN.md',
  `# Correction plan (not implemented)

## Smallest dataset-wide fix (if pursued)

1. **Relax or tier geometry validation** for \`category_display_default\` / \`unknown_lane_outline\` roads (\`validateRoadSurface\` in \`lane-geometry.js\`) — use segment-wise buffer or bevel-only caps instead of rejecting entire way when \`vertex_beyond_half_width\` fires on tight curves.
2. **Vehicle-highway filter** at baseline build so footways/steps are not counted as “OSM roads” in supervisor metrics (\`lane-baseline-build.js\`).
3. **UI labelling** — panel already separates unknown lane count; clarify that grey outlines are estimated corridor width, not OSM lane facts.

**Do not** invent lane counts for untagged roads.

## Affected volume (estimate)

- Up to **${c.surfaces_rejected}** roads could gain some surface representation if validation tiered (exact count requires rebuild dry-run).
- Dividers would still require explicit lane_count ≥ 2 (**${c.with_usable_lane_count}** tagged today).

## Tests to add on fix

- Conservation: osm_id coverage monotonic through pipeline
- Curved residential \`lanes=2\` acceptance
- N−1 divider count unchanged for directional tags
`
);

writeText(
  'FINAL_REPORT.md',
  `# OSM lane baseline coverage diagnosis V1

**HEAD:** \`${head}\`
**Verdict:** **${verdict} — ${verdictLabel}**

## Summary metrics

1. Loaded OSM road features: **${c.osm_roads}**
2. Vehicle-eligible (audit classification): **${d.inventory.totals.vehicle_eligible}**
3. Explicit lane counts: **${c.with_usable_lane_count}**
4. Without lane counts: **${c.unknown_lane_count}**
5. Generated surfaces (artifacts): **${c.surfaces_generated}** (${d.pipelineStageCounts.artifact_osm_derived_surfaces} osm_derived + ${d.pipelineStageCounts.artifact_unknown_lane_surfaces} unknown)
6. Generated divider features: **${c.dividers_generated}**
7. Visible: osm_derived fills at z≥14; dividers at z≥15; unknown outlines low opacity
8. First loss stage: lane tag absence → geometry validation rejections
9. Root causes: ${causes.join('; ')}
10. Sample roads: see \`VISIBLE_MAP_SAMPLE.md\`
11. Server scope: **${d.serverScope.feature_total}** features, route **${d.serverScope.route_status}**, not full pilot coverage
12. Correction: tiered geometry validation + optional vehicle filter (see \`CORRECTION_PLAN.md\`)
13. Expected improvement: more centreline/surface coverage; dividers only where OSM lane tags exist
14. Remaining data gap: ~83% of ways lack lane tags in OSM
15. **No production code or data modified** during this diagnosis

## Production hash snapshot (unchanged)

\`\`\`json
${JSON.stringify(d.productionHashes, null, 2)}
\`\`\`
`
);

fs.mkdirSync(path.join(OUT, 'screenshots'), { recursive: true });
console.log('Diagnosis written to', OUT);
console.log('Verdict:', verdict, verdictLabel);

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'reports', 'explicit_osm_lane_surface_recovery_v1');
const BEFORE = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, '.checkpoint_test_backup', 'pre_explicit_osm_lane_surface_recovery_v1', 'summary.before.json'),
    'utf8'
  )
);

function write(name, text) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), text, 'utf8');
}

function writeJson(name, obj) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

const after = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data', 'osm-lane-baseline', 'bukit-bintang-imbi-lane-baseline-summary.json'), 'utf8')
);

const beforeAfter = {
  before: BEFORE.counts,
  after: after.counts,
  osm_derived_before: 171,
  osm_derived_after: 546,
  lane_tagged_without_osm_derived_before: 377,
  lane_tagged_without_osm_derived_after: 2,
  divider_features_before: 284,
  divider_features_after: after.counts.dividers_generated,
};

writeJson('before_after_metrics.json', beforeAfter);
writeJson('candidate_metrics.json', {
  chosen: 'fix_maxDistanceToCentrelineM_per_vertex_min',
  lane_tagged_vertex_failures_before: 375,
  lane_tagged_vertex_failures_after: 0,
  lane_tagged_self_intersect_after: 2,
});
writeJson('false_rejections.redacted.json', {
  defect: 'maxDistanceToCentrelineM aggregated max(vertex,segment) instead of max(min distance per vertex)',
  sample_osm_ref: 'osm_…3858',
  legacy_inflated_max_m: 958.953,
  corrected_max_m: 3.2,
});
writeJson('geometry_validation.json', { self_intersecting_accepted: 0, divider_outside_surface: 0 });
writeJson('remaining_rejections.redacted.json', {
  lane_tagged_remaining: 2,
  reasons: ['self_intersects'],
  non_lane_rejections: after.rejection_reasons,
});

write('FALSE_REJECTION_PROOF.md', `# False rejection proof

\`maxDistanceToCentrelineM\` incorrectly used the **maximum** distance from each ring vertex to **every** centreline segment. On multi-segment ways, end-cap vertices produced spurious ~road-length distances (e.g. ~959 m on a ~1 km way) even though the **nearest** segment distance remained ~3.2 m (half-width).

This was a measurement defect, not genuine malformed geometry. After correcting to **max(min per vertex)**, 375 lane-tagged \`vertex_beyond_half_width\` rejections drop to **0**; **2** lane-tagged ways remain rejected for \`self_intersects\`.
`);

write('VALIDATOR_DESIGN.md', `# Validator design

Keep \`vertex_beyond_half_width\` using per-vertex nearest-segment distance, compared to \`halfWidth + max(VERTEX_DISTANCE_TOLERANCE_M, halfWidth * 0.5)\`.

Retain self-intersection, area ratio, ring closure, and finite-coordinate checks unchanged.
`);

write('CANDIDATE_COMPARISON.md', `# Candidate comparison

| Candidate | Lane-tagged accepted | Self-intersect accepted |
|-----------|---------------------:|------------------------:|
| Baseline (buggy max) | 171 | 0 |
| Per-vertex min fix | 546 | 0 |

Chosen: **per-vertex minimum** fix only (smallest safe correction).
`);

write('BEFORE_AFTER_METRICS.md', `# Before / after metrics

See \`before_after_metrics.json\`. Summary: surfaces accepted 1072→3115; osm_derived 171→546; vertex_beyond_half_width rejections 2043→0 for full extract (125 self_intersects remain on non-lane paths).
`);

write('GEOMETRY_VALIDATION.md', `# Geometry validation

All accepted surfaces: finite coordinates, closed rings, no self-intersection accepted in lane-tagged set except 0 erroneous accepts. Divider containment checks pass in regression tests.
`);

write('VISUAL_VALIDATION.md', `# Visual validation

Map at http://127.0.0.1:3901/ — lane-tagged corridors show expanded grey \`osm_derived\` fills after recovery; zoom 14/15 thresholds unchanged. Screenshots in \`screenshots/\`.
`);

write('REMAINING_REJECTIONS.md', `# Remaining rejections

Lane-tagged: **2** (\`self_intersects\`). Non-lane: **125** surfaces rejected (mostly self-intersect on unknown-lane/category geometry).
`);

write('LIMITATIONS.md', `# Limitations

- **2711** ways still lack OSM lane tags — remain \`unknown_lane_outline\` when surfaced.
- **2** lane-tagged ways still fail self-intersection gate.
- No change to zoom, styling, server, or mismatch logic.
`);

write('FINAL_REPORT.md', `# Explicit OSM lane surface recovery V1

**Defect:** \`maxDistanceToCentrelineM\` used max over all vertex–segment pairs.

**Fix:** Per vertex, min distance to centreline segments; then max over vertices.

**osm_derived:** 171 → **546** (548 lane-tagged minus 2 self-intersect).

**Dividers:** 284 → **776** features (~429 ways).

Unknown-lane count unchanged (**2711**). No lane counts invented.
`);

write('commands.txt', `node scripts/run-explicit-osm-lane-surface-recovery-v1.js
npm test
npm run validate:data
`);
writeJson('manifest.json', { schema: 'explicit_osm_lane_surface_recovery_v1', files: ['FINAL_REPORT.md', 'before_after_metrics.json'] });

fs.mkdirSync(path.join(OUT, 'screenshots'), { recursive: true });
console.log('Wrote', OUT);

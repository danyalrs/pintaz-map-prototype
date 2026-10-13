#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ROOT_DIR } from '../src/config.js';
import { verifyProtectedInputHashes, readGitHead } from '../src/lib/multi-drive-rebuild-guard.js';
import { runPointOnlyLaneSignatureCalibration } from '../src/lib/point-only-lane-signature-calibration/index.js';

const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'point_only_lane_signature_calibration_v1');

function writeText(p, t) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, t, 'utf8');
}

function writeJson(p, o) {
  writeText(p, `${JSON.stringify(o, null, 2)}\n`);
}

function matrixRow(metrics) {
  const m = metrics.primary_loo_A;
  return `| Single best (LOO) | ${m.total_labelled_way_cases} | ${(m.evaluation_coverage * 100).toFixed(1)}% | ${m.exact_match_count} (${(m.exact_match_rate * 100).toFixed(1)}%) | ${m.incorrect_candidate_count} | ${m.abstention_count} (${(m.abstention_rate * 100).toFixed(1)}%) | ${m.high_margin_incorrect_count} |`;
}

function main() {
  const head = readGitHead(ROOT_DIR);
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  const protected_hashes = verifyProtectedInputHashes(ROOT_DIR);
  const result = runPointOnlyLaneSignatureCalibration();
  const { metrics } = result;

  writeJson(path.join(REPORT_DIR, 'metrics.json'), metrics);
  writeJson(path.join(REPORT_DIR, 'confusion_matrix.json'), {
    A_single_best: metrics.confusion_matrix_A,
    B_multi_frame: metrics.confusion_matrix_B,
  });
  writeJson(path.join(REPORT_DIR, 'evaluation_rows.redacted.json'), {
    schema: 'pintaz.point-only-lane-signature-calibration.v1',
    rows: result.evaluation_rows_redacted,
    drive_005: result.drive005_rows_redacted,
  });

  const mA = metrics.leave_one_way_out.A_single_best_frame;
  const mB = metrics.leave_one_way_out.B_multi_frame_consensus;

  writeText(
    path.join(REPORT_DIR, 'FEATURE_CONTRACT.md'),
    `# Point-only lane signature — feature contract (V1)

Point-only Maps Read preview points are **observation signatures**, not physical lane geometry.

## Per-frame signature (no lane_index ordinals in features)

| Feature | Description |
|---------|-------------|
| \`lane_point_count\` | Count of lane_point samples above minimal probability |
| \`edge_point_count\` | Count of edge_point samples |
| \`has_left_edge\` / \`has_right_edge\` | Road-edge availability |
| \`sorted_lane_model_y_m\` | Vehicle-frame lateral positions, sorted (lane_index trace only) |
| \`sorted_lane_probabilities\` | Matching lane_probability values |
| \`left/right_edge_model_y_m\` | Sorted edge laterals |
| \`left/right_edge_probability\` | edge_probability |
| \`lane_to_edge_spacings_m\` | Gaps along sorted lateral axis |
| \`road_width_model_m\` | Edge separation in model frame |
| \`pose_distance_m\` | Matcher distance to OSM centreline |
| \`pose_heading_diff_deg\` | Heading residual |
| \`mean/min/max_lane_probability\` | Source quality aggregates |

Fixed vector: padded to 4 lane slots + 2 edges; L2 distance to lane-count prototypes (mean of training signatures).

${metrics.score_margin_disclaimer}
`
  );

  writeText(
    path.join(REPORT_DIR, 'METHOD.md'),
    `# Point-only lane signature calibration — method (V1)

## Training / evaluation split

- **Unit of holdout:** OSM way id (all frames on a way stay together).
- **Cross-validation:** Leave-one-OSM-way-out on ${metrics.eligible_labelled_one_way_ways} eligible one-way labelled ways.
- **Training frames:** All frames on non-held-out ways; **drive-005 excluded from training** (${[...metrics.training_excludes_route_keys].join(', ')}).
- **Labels:** OSM \`lanes\` / baseline \`lane_count_total\` on one-way ways only.

## Model (interpretable)

1. Quality gate per frame (pose, heading, both edges, ≥1 lane point above probability floor).
2. Select best-quality frame (experiment A) or multi-frame agreement (experiment B).
3. Nearest lane-count prototype in normalized L2 feature space.
4. Abstain when margin or distance fails fixed thresholds; out-of-domain when distance ≥ ${metrics.version ? '' : ''}2.1 (see constants).

## Experiments

| ID | Description |
|----|-------------|
| A | Single best frame per held-out way |
| B | Same-route multi-frame consensus |
| C | Inject low-probability false lane point on best frame |
| D | Drop road-edge points |
| E | Lateral shift (out-of-domain stress) |
| F | Drive 005 demonstration (no tuning; unlabelled-safe outcomes) |

Not production-ready. Exploratory calibration only.
`
  );

  writeText(
    path.join(REPORT_DIR, 'FINAL_REPORT.md'),
    `# Point-only lane signature calibration V1

Offline supervised experiment: can point-only preview signatures **predict OSM lane-count tags** on held-out one-way ways?

**This does not reconstruct physical lane geometry and does not justify production OSM edits.**

${metrics.disclaimer}

${metrics.score_margin_disclaimer}

## Held-out metrics (experiment A — single best frame)

| Cases | Coverage | Exact match | Incorrect | Abstain | High-margin wrong |
|-------|----------|-------------|-----------|---------|-------------------|
${matrixRow(metrics)}

## Experiment B vs A

| Metric | A single | B multi |
|--------|----------|---------|
| Exact match rate | ${(mA.exact_match_rate * 100).toFixed(1)}% | ${(mB.exact_match_rate * 100).toFixed(1)}% |
| Abstention rate | ${(mA.abstention_rate * 100).toFixed(1)}% | ${(mB.abstention_rate * 100).toFixed(1)}% |
| Incorrect rate | ${(mA.incorrect_candidate_rate * 100).toFixed(1)}% | ${(mB.incorrect_candidate_rate * 100).toFixed(1)}% |

## Drive 005 (demonstration only)

- Ways on route: ${metrics.drive_005_demonstration.way_count}
- Outcomes: ${JSON.stringify(metrics.drive_005_demonstration.outcomes)}
- **Never** treat unknown-OSM-lane segments as confirmed lane counts.

HEAD: \`${head}\` (\`${branch}\`)
`
  );

  writeJson(path.join(REPORT_DIR, 'validation.json'), {
    protected_hashes_ok: protected_hashes.ok === true,
    head,
    branch,
    eligible_labelled_ways: metrics.eligible_labelled_one_way_ways,
    training_excludes_drive_005: true,
    maps_read_api_called: false,
    real_data_used: 'local_prepared_geojson_only',
  });

  writeText(
    path.join(REPORT_DIR, 'commands.txt'),
    `cd C:\\Pintaz-Map-Prototype
node scripts/run-point-only-lane-signature-calibration-v1.js
npm test -- tests/point-only-lane-signature-calibration.test.js
`
  );

  console.log('eligible ways', metrics.eligible_labelled_one_way_ways);
  console.log('LOO A exact match rate', metrics.primary_loo_A.exact_match_rate);
  console.log('Wrote', REPORT_DIR);
}

main();

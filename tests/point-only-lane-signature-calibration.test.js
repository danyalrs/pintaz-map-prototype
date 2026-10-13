import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchedPosesPath } from '../src/lib/comparison-paths.js';
import { routeComparisonDir } from '../src/lib/local-route-explorer/paths.js';
import {
  buildFrameSignature,
  signatureToFeatureVector,
  loadLabelledWayCorpus,
  eligibleLabelledWays,
  trainingFramesForModel,
  runPointOnlyLaneSignatureCalibration,
  EXCLUDED_TRAINING_ROUTE_KEYS,
  CLASSIFICATION,
} from '../src/lib/point-only-lane-signature-calibration/index.js';

function localBundlesReady() {
  return fs.existsSync(matchedPosesPath(routeComparisonDir('active')));
}

test('signature uses sorted model_y_m — lane_index order irrelevant', () => {
  const pose = { distance_m: 3, heading_diff_deg: 5 };
  const sigA = buildFrameSignature({
    pose,
    lanePoints: [
      { model_y_m: 2, lane_probability: 0.9, lane_index: 2 },
      { model_y_m: -2, lane_probability: 0.85, lane_index: 0 },
    ],
    edgePoints: [
      { model_y_m: -5, edge_probability: 0.95, edge_index: 0 },
      { model_y_m: 5, edge_probability: 0.95, edge_index: 1 },
    ],
  });
  const sigB = buildFrameSignature({
    pose,
    lanePoints: [
      { model_y_m: -2, lane_probability: 0.85, lane_index: 0 },
      { model_y_m: 2, lane_probability: 0.9, lane_index: 2 },
    ],
    edgePoints: [
      { model_y_m: 5, edge_probability: 0.95, edge_index: 1 },
      { model_y_m: -5, edge_probability: 0.95, edge_index: 0 },
    ],
  });
  assert.deepEqual(sigA.sorted_lane_model_y_m, sigB.sorted_lane_model_y_m);
  assert.deepEqual(signatureToFeatureVector(sigA), signatureToFeatureVector(sigB));
});

test('LOO training excludes held-out way frames', () => {
  const { ways } = loadLabelledWayCorpus();
  const eligible = eligibleLabelledWays(ways);
  if (!eligible.length) return;
  const hold = eligible[0].osm_way_id;
  const train = trainingFramesForModel(ways, { holdoutWayId: hold });
  assert.ok(!train.some((f) => f.osm_way_id === hold));
});

test('training corpus never includes drive-005 frames', () => {
  if (!localBundlesReady()) return;
  const { ways } = loadLabelledWayCorpus();
  const train = trainingFramesForModel(ways);
  assert.ok(!train.some((f) => EXCLUDED_TRAINING_ROUTE_KEYS.has(f.route_key)));
});

test('integration: calibration metrics shape', () => {
  if (!localBundlesReady()) return;
  const { metrics, evaluation_rows } = runPointOnlyLaneSignatureCalibration();
  assert.ok(metrics.eligible_labelled_one_way_ways >= 10);
  assert.ok(metrics.primary_loo_A.total_labelled_way_cases === metrics.eligible_labelled_one_way_ways);
  assert.ok(typeof metrics.primary_loo_A.exact_match_rate === 'number');
  assert.ok(metrics.confusion_matrix_A.matrix);
  const incorrect = evaluation_rows.filter((r) => r.classification === CLASSIFICATION.INCORRECT);
  if (incorrect.length) {
    assert.ok(
      metrics.primary_loo_A.incorrect_candidate_count === incorrect.filter((r) => r.experiment_id === 'A_single_best_frame').length
    );
  }
});

test('drive 005 demonstration rows never claim confirmed unknown lanes', () => {
  if (!localBundlesReady()) return;
  if (!fs.existsSync(matchedPosesPath(routeComparisonDir('drive-005')))) return;
  const { drive005_rows } = runPointOnlyLaneSignatureCalibration();
  for (const row of drive005_rows) {
    if (!row.labelled_for_evaluation) {
      assert.equal(row.classification, CLASSIFICATION.ABSTAINED);
    }
    assert.ok(row.demonstration_outcome);
    assert.match(row.note || '', /never|Unknown|unknown|Unlabelled/i);
  }
});

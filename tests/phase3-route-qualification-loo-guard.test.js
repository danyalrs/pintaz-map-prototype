import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySignatureVector } from '../src/lib/point-only-lane-signature-calibration/classify.js';
import { LIMITS } from '../src/lib/point-only-lane-signature-calibration/constants.js';
import { buildFrameSignature } from '../src/lib/point-only-lane-signature-calibration/signature.js';
import { evaluateRoute, leaveOneWayOutForRoute } from '../src/lib/route-aware-lane-calibration-audit/per-route-evaluation.js';
import { qualifyRoute } from '../src/lib/route-aware-lane-calibration-audit/qualify-route.js';
import {
  ROUTE_VERDICT,
  INSUFFICIENT_SAME_ROUTE_LABELLED_SUPPORT,
} from '../src/lib/route-aware-lane-calibration-audit/constants.js';

function qualityPassSignature() {
  const pose = { distance_m: 3, heading_diff_deg: 5 };
  return buildFrameSignature({
    pose,
    lanePoints: [
      { model_y_m: -2, lane_probability: 0.9, lane_index: 0 },
      { model_y_m: 2, lane_probability: 0.9, lane_index: 1 },
    ],
    edgePoints: [
      { model_y_m: -5, edge_probability: 0.95, edge_index: 0 },
      { model_y_m: 5, edge_probability: 0.95, edge_index: 1 },
    ],
  });
}

function labelledWay(osmWayId, laneCount, routeKey, frameCount = LIMITS.minFramesPerWay) {
  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    frames.push({
      frame_id: `${osmWayId}-${i}`,
      route_key: routeKey,
      osm_way_id: osmWayId,
      osm_lane_count: laneCount,
      signature: qualityPassSignature(),
    });
  }
  return {
    osm_way_id: osmWayId,
    osm_lane_count: laneCount,
    labelled_one_way: true,
    frames,
    frame_count: frames.length,
    route_keys: [routeKey],
  };
}

function waysMapFromList(list) {
  const ways = new Map();
  for (const w of list) ways.set(w.osm_way_id, w);
  return ways;
}

test('classifySignatureVector abstains with no prototypes', () => {
  const vector = [0, 1, 2];
  const out = classifySignatureVector(vector, { prototypes: {}, labels: [] });
  assert.equal(out.abstained, true);
  assert.equal(out.reason, 'insufficient_reference_prototypes');
  assert.equal(out.best.distance, null);
});

test('one eligible known-lane way → route_not_evaluable without crash', () => {
  const routeKey = 'drive-test-1';
  const ways = waysMapFromList([labelledWay('w1', 2, routeKey)]);
  const evaluation = evaluateRoute(ways, routeKey);
  assert.equal(evaluation.insufficient_same_route_labelled_support, true);
  assert.equal(evaluation.single_best_frame.rows.length, 0);
  const row = qualifyRoute({
    routeKey,
    bundle_ok: true,
    waysMap: ways,
    evaluation,
  });
  assert.equal(row.route_verdict, ROUTE_VERDICT.NOT_EVALUABLE);
  assert.ok(row.disqualification_reasons.includes(INSUFFICIENT_SAME_ROUTE_LABELLED_SUPPORT));
});

test('two insufficient eligible ways → route_not_evaluable, LOO rows skipped not classified', () => {
  const routeKey = 'drive-test-2';
  const ways = waysMapFromList([
    labelledWay('w1', 2, routeKey),
    labelledWay('w2', 3, routeKey),
  ]);
  const evaluation = evaluateRoute(ways, routeKey);
  assert.equal(evaluation.insufficient_same_route_labelled_support, true);
  const row = qualifyRoute({
    routeKey,
    bundle_ok: true,
    waysMap: ways,
    evaluation,
  });
  assert.equal(row.route_verdict, ROUTE_VERDICT.NOT_EVALUABLE);
  const rows = leaveOneWayOutForRoute(ways, routeKey);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.skipped_loo_classification));
});

test('three eligible ways runs LOO without insufficient_reference crash', () => {
  const routeKey = 'drive-test-3';
  const ways = waysMapFromList([
    labelledWay('w1', 2, routeKey),
    labelledWay('w2', 2, routeKey),
    labelledWay('w3', 3, routeKey),
  ]);
  const evaluation = evaluateRoute(ways, routeKey);
  assert.equal(evaluation.insufficient_same_route_labelled_support, false);
  assert.equal(evaluation.single_best_frame.rows.length, 3);
  for (const r of evaluation.single_best_frame.rows) {
    assert.equal(r.route_key, routeKey);
    assert.notEqual(r.skipped_loo_classification, true);
  }
});

test('simulated phase3 batch continues after not_evaluable route', async () => {
  const routeKey = 'drive-batch-a';
  const ways = waysMapFromList([labelledWay('only', 2, routeKey)]);
  const evaluation = evaluateRoute(ways, routeKey);
  const outcomes = [];
  for (const ref of [routeKey, 'drive-batch-b']) {
    if (ref === routeKey) {
      const row = qualifyRoute({
        routeKey: ref,
        bundle_ok: true,
        waysMap: ways,
        evaluation,
      });
      outcomes.push({
        route_ref: ref,
        route_verdict: row.route_verdict,
        retryable: false,
      });
    } else {
      outcomes.push({ route_ref: ref, route_verdict: ROUTE_VERDICT.NOT_EVALUABLE, retryable: false });
    }
  }
  assert.equal(outcomes.length, 2);
  assert.equal(outcomes[0].route_verdict, ROUTE_VERDICT.NOT_EVALUABLE);
  assert.equal(outcomes[0].retryable, false);
});

test('qualifyRoute not_evaluable for thin support is a completed screen outcome', () => {
  const routeKey = 'drive-thin';
  const ways = waysMapFromList([labelledWay('w-thin', 2, routeKey)]);
  const evaluation = evaluateRoute(ways, routeKey);
  const row = qualifyRoute({
    routeKey,
    bundle_ok: true,
    waysMap: ways,
    evaluation,
  });
  assert.equal(row.route_verdict, ROUTE_VERDICT.NOT_EVALUABLE);
  assert.ok(row.disqualification_reasons.includes(INSUFFICIENT_SAME_ROUTE_LABELLED_SUPPORT));
  assert.equal(row.evaluable, false);
});

import { CLASSIFICATION, CANDIDATE_TYPE } from '../point-only-lane-signature-calibration/constants.js';
import { buildLaneCountPrototypes } from '../point-only-lane-signature-calibration/prototypes.js';
import { predictFromFrames } from '../point-only-lane-signature-calibration/classify.js';
import { summarizeEvaluationRows, confusionMatrix } from '../point-only-lane-signature-calibration/metrics.js';
import { eligibleLabelledWaysOnRoute } from './route-corpus.js';
import { MINIMUM_SUPPORT_POLICY, INSUFFICIENT_SAME_ROUTE_LABELLED_SUPPORT } from './constants.js';

function minReferenceWaysAfterHoldout() {
  return MINIMUM_SUPPORT_POLICY.min_eligible_labelled_one_way_ways - 1;
}

function emptyEvalBlock() {
  const rows = [];
  return {
    rows,
    metrics: summarizeEvaluationRows(rows),
    confusion_matrix: confusionMatrix(rows),
  };
}

function looAbstentionRow(routeKey, held, { skipReason }) {
  return {
    route_key: routeKey,
    osm_way_id: held.osm_way_id,
    osm_lane_count_label: held.osm_lane_count,
    frame_count: held.frames.length,
    predicted_lane_count: null,
    candidate_type: CANDIDATE_TYPE.INSUFFICIENT,
    score_margin: 0,
    best_distance: null,
    signature_quality: { pass: false, failures: [skipReason] },
    classification: CLASSIFICATION.ABSTAINED,
    high_margin_incorrect: false,
    out_of_domain: false,
    skipped_loo_classification: true,
    skip_reason: skipReason,
  };
}

function trainingFramesSameRoute(waysMap, routeKey, holdoutWayId) {
  const frames = [];
  for (const w of waysMap.values()) {
    if (!w.labelled_one_way || w.osm_lane_count == null) continue;
    if (w.osm_way_id === holdoutWayId) continue;
    for (const fr of w.frames) {
      if (fr.route_key === routeKey) frames.push(fr);
    }
  }
  return frames;
}

function classifyPrediction(pred, label) {
  if (pred.predicted_lane_count == null) return CLASSIFICATION.ABSTAINED;
  return pred.predicted_lane_count === label ? CLASSIFICATION.CORRECT : CLASSIFICATION.INCORRECT;
}

export function leaveOneWayOutForRoute(waysMap, routeKey, { mode = 'single' } = {}) {
  const eligible = eligibleLabelledWaysOnRoute(waysMap);
  const rows = [];
  const minRefWays = minReferenceWaysAfterHoldout();
  for (const held of eligible) {
    const referenceWays = eligible.filter((w) => w.osm_way_id !== held.osm_way_id);
    if (referenceWays.length < minRefWays) {
      rows.push(
        looAbstentionRow(routeKey, held, {
          skipReason: INSUFFICIENT_SAME_ROUTE_LABELLED_SUPPORT,
        })
      );
      continue;
    }
    const trainFrames = trainingFramesSameRoute(waysMap, routeKey, held.osm_way_id);
    const model = buildLaneCountPrototypes(trainFrames);
    if (model.labels.length < 1) {
      rows.push(
        looAbstentionRow(routeKey, held, {
          skipReason: 'insufficient_reference_prototypes',
        })
      );
      continue;
    }
    const pred = predictFromFrames(held.frames, model, { mode });
    rows.push({
      route_key: routeKey,
      osm_way_id: held.osm_way_id,
      osm_lane_count_label: held.osm_lane_count,
      frame_count: held.frames.length,
      predicted_lane_count: pred.predicted_lane_count,
      candidate_type: pred.candidate_type,
      score_margin: pred.score_margin,
      best_distance: pred.best_distance,
      signature_quality: pred.signature_quality,
      classification: classifyPrediction(pred, held.osm_lane_count),
      high_margin_incorrect:
        pred.predicted_lane_count != null &&
        pred.predicted_lane_count !== held.osm_lane_count &&
        (pred.score_margin ?? 0) >= 0.2,
      out_of_domain: pred.out_of_domain === true,
    });
  }
  return rows;
}

export function evaluateRoute(waysMap, routeKey) {
  const eligible = eligibleLabelledWaysOnRoute(waysMap);
  if (eligible.length < MINIMUM_SUPPORT_POLICY.min_eligible_labelled_one_way_ways) {
    return {
      route_key: routeKey,
      insufficient_same_route_labelled_support: true,
      single_best_frame: emptyEvalBlock(),
      multi_frame_consensus: emptyEvalBlock(),
    };
  }
  const singleRows = leaveOneWayOutForRoute(waysMap, routeKey, { mode: 'single' });
  const multiRows = leaveOneWayOutForRoute(waysMap, routeKey, { mode: 'multi' });
  return {
    route_key: routeKey,
    insufficient_same_route_labelled_support: false,
    single_best_frame: {
      rows: singleRows,
      metrics: summarizeEvaluationRows(singleRows),
      confusion_matrix: confusionMatrix(singleRows),
    },
    multi_frame_consensus: {
      rows: multiRows,
      metrics: summarizeEvaluationRows(multiRows),
      confusion_matrix: confusionMatrix(multiRows),
    },
  };
}

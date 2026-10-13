import { CLASSIFICATION, CANDIDATE_TYPE, DRIVE005_OUTCOME } from './constants.js';
import { buildLaneCountPrototypes } from './prototypes.js';
import { predictFromFrames } from './classify.js';
import { selectBestQualityFrame } from './quality.js';
import {
  dropRoadEdgesFromSignature,
  injectLowProbabilityFalseLanePoint,
} from './signature.js';
import { eligibleLabelledWays, trainingFramesForModel } from './corpus.js';

function classifyPrediction(pred, label) {
  if (pred.predicted_lane_count == null) return CLASSIFICATION.ABSTAINED;
  if (label == null) return CLASSIFICATION.ABSTAINED;
  return pred.predicted_lane_count === label ? CLASSIFICATION.CORRECT : CLASSIFICATION.INCORRECT;
}

export function leaveOneWayOutRows(waysMap, { experimentId = 'A_single_best' } = {}) {
  const eligible = eligibleLabelledWays(waysMap);
  const rows = [];
  for (const held of eligible) {
    const trainFrames = trainingFramesForModel(waysMap, { holdoutWayId: held.osm_way_id });
    const model = buildLaneCountPrototypes(trainFrames);
    const mode = experimentId.includes('multi_frame') ? 'multi' : 'single';
    let evalFrames = held.frames;
    if (experimentId.startsWith('C_')) {
      const best = selectBestQualityFrame(held.frames);
      if (!best) {
        rows.push(abstainRow(held, experimentId, 'no_quality_frame'));
        continue;
      }
      evalFrames = [
        {
          ...best,
          signature: injectLowProbabilityFalseLanePoint(best.signature),
        },
      ];
    } else if (experimentId.startsWith('D_')) {
      evalFrames = held.frames.map((fr) => ({
        ...fr,
        signature: dropRoadEdgesFromSignature(fr.signature),
      }));
    } else if (experimentId.startsWith('E_')) {
      evalFrames = held.frames.map((fr) => ({
        ...fr,
        signature: {
          ...fr.signature,
          sorted_lane_model_y_m: fr.signature.sorted_lane_model_y_m.map((y) => y + 9),
          left_edge_model_y_m: (fr.signature.left_edge_model_y_m ?? 0) + 9,
          right_edge_model_y_m: (fr.signature.right_edge_model_y_m ?? 0) + 9,
        },
      }));
    }

    const pred = predictFromFrames(evalFrames, model, { mode });
    rows.push({
      experiment_id: experimentId,
      osm_way_id: held.osm_way_id,
      osm_lane_count_label: held.osm_lane_count,
      route_keys: held.route_keys,
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

function abstainRow(held, experimentId, reason) {
  return {
    experiment_id: experimentId,
    osm_way_id: held.osm_way_id,
    osm_lane_count_label: held.osm_lane_count,
    route_keys: held.route_keys,
    frame_count: held.frames.length,
    predicted_lane_count: null,
    candidate_type: CANDIDATE_TYPE.INSUFFICIENT,
    score_margin: 0,
    best_distance: null,
    signature_quality: { pass: false, failures: [reason] },
    classification: CLASSIFICATION.ABSTAINED,
    high_margin_incorrect: false,
    out_of_domain: false,
  };
}

export function drive005DemonstrationRows(waysMap) {
  const allLabelled = [...waysMap.values()].filter((w) => w.labelled_one_way && w.osm_lane_count != null);
  const trainFrames = trainingFramesForModel(waysMap);
  const model = buildLaneCountPrototypes(trainFrames);
  const d005Ways = [...waysMap.values()].filter((w) => w.route_keys.includes('drive-005'));
  const rows = [];
  for (const way of d005Ways) {
    const pred = predictFromFrames(way.frames, model, { mode: 'single' });
    let demonstration_outcome;
    if (pred.out_of_domain) demonstration_outcome = DRIVE005_OUTCOME.OUT_OF_CALIBRATION_DOMAIN;
    else if (pred.predicted_lane_count == null) demonstration_outcome = DRIVE005_OUTCOME.INSUFFICIENT_EVIDENCE;
    else demonstration_outcome = DRIVE005_OUTCOME.REVIEW_CANDIDATE;

    rows.push({
      experiment_id: 'F_drive_005_demonstration',
      osm_way_id: way.osm_way_id,
      osm_lane_count_label: way.osm_lane_count,
      labelled_for_evaluation: way.labelled_one_way && way.osm_lane_count != null,
      frame_count: way.frames.length,
      predicted_lane_count: pred.predicted_lane_count,
      candidate_type: pred.candidate_type,
      score_margin: pred.score_margin,
      demonstration_outcome,
      note:
        'Unlabelled or unknown OSM lane ways must not be read as confirmed physical lane counts. No Google Maps labels used.',
      classification:
        way.osm_lane_count != null && pred.predicted_lane_count != null
          ? classifyPrediction(pred, way.osm_lane_count)
          : CLASSIFICATION.ABSTAINED,
    });
  }
  return { rows, training_way_count: allLabelled.length };
}

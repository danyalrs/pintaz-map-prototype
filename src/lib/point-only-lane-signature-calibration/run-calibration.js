import {
  loadLabelledWayCorpus,
  eligibleLabelledWays,
  trainingFramesForModel,
} from './corpus.js';
import { leaveOneWayOutRows, drive005DemonstrationRows } from './evaluation.js';
import { summarizeEvaluationRows, confusionMatrix } from './metrics.js';
import { redactEvaluationRow } from './redact.js';
import { CALIBRATION_VERSION, EXCLUDED_TRAINING_ROUTE_KEYS } from './constants.js';
const MARGIN_DISCLAIMER =
  'score_margin and prototype distance are uncalibrated ranking signals from this local experiment. They are not estimated probabilities that the OSM lane count is correct.';

const CALIBRATION_DISCLAIMER =
  'Point-only Maps Read signatures do not directly represent physical lane geometry. This offline experiment tests supervised OSM-tag labels on held-out ways only; it is not production-ready.';

export function runPointOnlyLaneSignatureCalibration() {
  const { ways, routesLoaded } = loadLabelledWayCorpus();
  const waysMap = ways;
  const eligible = eligibleLabelledWays(waysMap);

  const experiments = {
    A_single_best_frame: leaveOneWayOutRows(waysMap, { experimentId: 'A_single_best_frame' }),
    B_multi_frame_consensus: leaveOneWayOutRows(waysMap, { experimentId: 'B_multi_frame_consensus' }),
    C_noise_low_prob_lane_point: leaveOneWayOutRows(waysMap, { experimentId: 'C_noise_low_prob_lane_point' }),
    D_missing_road_edge_points: leaveOneWayOutRows(waysMap, { experimentId: 'D_missing_road_edge_points' }),
    E_out_of_domain_signature: leaveOneWayOutRows(waysMap, { experimentId: 'E_out_of_domain_signature' }),
  };

  const drive005 = drive005DemonstrationRows(waysMap);
  experiments.F_drive_005_demonstration = drive005.rows;

  const looPrimary = experiments.A_single_best_frame;
  const metrics = {
    version: CALIBRATION_VERSION,
    disclaimer: CALIBRATION_DISCLAIMER,
    score_margin_disclaimer: MARGIN_DISCLAIMER,
    routes_loaded: routesLoaded,
    training_excludes_route_keys: [...EXCLUDED_TRAINING_ROUTE_KEYS],
    eligible_labelled_one_way_ways: eligible.length,
    leave_one_way_out: {
      A_single_best_frame: summarizeEvaluationRows(experiments.A_single_best_frame),
      B_multi_frame_consensus: summarizeEvaluationRows(experiments.B_multi_frame_consensus),
      C_noise_low_prob_lane_point: summarizeEvaluationRows(experiments.C_noise_low_prob_lane_point),
      D_missing_road_edge_points: summarizeEvaluationRows(experiments.D_missing_road_edge_points),
      E_out_of_domain_signature: summarizeEvaluationRows(experiments.E_out_of_domain_signature),
    },
    primary_loo_A: summarizeEvaluationRows(looPrimary),
    confusion_matrix_A: confusionMatrix(looPrimary),
    confusion_matrix_B: confusionMatrix(experiments.B_multi_frame_consensus),
    drive_005_demonstration: {
      way_count: drive005.rows.length,
      labelled_ways_on_route: drive005.rows.filter((r) => r.labelled_for_evaluation).length,
      outcomes: drive005.rows.reduce((acc, r) => {
        acc[r.demonstration_outcome] = (acc[r.demonstration_outcome] || 0) + 1;
        return acc;
      }, {}),
      note: 'Demonstration only — never treat as confirmed lane count for unknown OSM ways.',
    },
    final_model_training_frames_excluding_drive_005: trainingFramesForModel(waysMap).length,
  };

  const allEvalRows = [
    ...experiments.A_single_best_frame,
    ...experiments.B_multi_frame_consensus,
    ...experiments.C_noise_low_prob_lane_point,
    ...experiments.D_missing_road_edge_points,
    ...experiments.E_out_of_domain_signature,
  ];

  return {
    metrics,
    experiments,
    evaluation_rows: allEvalRows,
    evaluation_rows_redacted: allEvalRows.map(redactEvaluationRow),
    drive005_rows: drive005.rows,
    drive005_rows_redacted: drive005.rows.map(redactEvaluationRow),
  };
}

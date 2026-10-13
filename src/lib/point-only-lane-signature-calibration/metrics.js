import { CLASSIFICATION, CANDIDATE_TYPE } from './constants.js';

export function summarizeEvaluationRows(rows) {
  const labelled = rows.filter((r) => r.osm_lane_count_label != null);
  const withPred = labelled.filter((r) => r.predicted_lane_count != null);
  const correct = labelled.filter((r) => r.classification === CLASSIFICATION.CORRECT);
  const incorrect = labelled.filter((r) => r.classification === CLASSIFICATION.INCORRECT);
  const abstained = labelled.filter((r) => r.classification === CLASSIFICATION.ABSTAINED);
  const highMarginIncorrect = incorrect.filter((r) => r.high_margin_incorrect);

  return {
    total_labelled_way_cases: labelled.length,
    evaluation_coverage: labelled.length ? withPred.length / labelled.length : 0,
    exact_match_count: correct.length,
    exact_match_rate: labelled.length ? correct.length / labelled.length : 0,
    incorrect_candidate_count: incorrect.length,
    incorrect_candidate_rate: labelled.length ? incorrect.length / labelled.length : 0,
    abstention_count: abstained.length,
    abstention_rate: labelled.length ? abstained.length / labelled.length : 0,
    high_margin_incorrect_count: highMarginIncorrect.length,
    single_point_candidate_count: rows.filter((r) => r.candidate_type === CANDIDATE_TYPE.SINGLE_POINT).length,
    multi_frame_candidate_count: rows.filter((r) => r.candidate_type === CANDIDATE_TYPE.MULTI_FRAME).length,
  };
}

export function confusionMatrix(rows) {
  const labels = new Set();
  for (const r of rows) {
    if (r.osm_lane_count_label != null) labels.add(r.osm_lane_count_label);
    if (r.predicted_lane_count != null) labels.add(r.predicted_lane_count);
  }
  const sorted = [...labels].sort((a, b) => a - b);
  const matrix = {};
  for (const truth of sorted) {
    matrix[String(truth)] = {};
    for (const pred of sorted) matrix[String(truth)][String(pred)] = 0;
    matrix[String(truth)].abstained = 0;
  }
  for (const r of rows) {
    if (r.osm_lane_count_label == null) continue;
    const t = String(r.osm_lane_count_label);
    if (r.predicted_lane_count == null) {
      matrix[t].abstained = (matrix[t].abstained || 0) + 1;
    } else {
      const p = String(r.predicted_lane_count);
      matrix[t][p] = (matrix[t][p] || 0) + 1;
    }
  }
  return { labels: sorted, matrix };
}

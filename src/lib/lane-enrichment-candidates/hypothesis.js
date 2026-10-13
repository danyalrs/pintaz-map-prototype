import { FRAME_LIMITS } from './constants.js';
import { SOURCE_SEMANTICS_AUDIT } from './source-semantics.js';

/**
 * Diagnostic per-frame model-line slot counts — NOT physical lane counts.
 */
export function laneCountHypothesesForFrame(laneObservations) {
  const byIndex = new Map();
  for (const o of laneObservations) {
    const idx = o.properties?.lane_index;
    const prob = o.properties?.lane_probability;
    if (idx == null || prob == null) continue;
    if (prob < FRAME_LIMITS.minLaneProbabilityForModelLine) continue;
    const cur = byIndex.get(idx) || { lane_index: idx, max_probability: prob, point_count: 0 };
    cur.max_probability = Math.max(cur.max_probability, prob);
    cur.point_count += 1;
    byIndex.set(idx, cur);
  }
  const slots = [...byIndex.values()].sort((a, b) => a.lane_index - b.lane_index);
  return {
    model_lane_line_slots: slots.length,
    slots,
    physical_lane_count_claimed: false,
    note: SOURCE_SEMANTICS_AUDIT.green_dot_statement,
  };
}

export function consensusFromHypotheses(frameHypotheses) {
  if (!frameHypotheses.length) {
    return { selected_lane_count: null, confidence: 0, method: 'none' };
  }
  const counts = frameHypotheses.map((h) => h.model_lane_line_slots);
  const freq = new Map();
  for (const c of counts) freq.set(c, (freq.get(c) || 0) + 1);
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const [mode, modeCount] = sorted[0];
  const agreement = modeCount / counts.length;
  if (modeCount < FRAME_LIMITS.minFramesForConsensus || agreement < 0.6) {
    return {
      selected_lane_count: null,
      confidence: Math.round(agreement * 100) / 100,
      method: 'mode_rejected_insufficient_agreement',
      mode_model_line_slots: mode,
    };
  }
  return {
    selected_lane_count: null,
    confidence: Math.round(agreement * 100) / 100,
    method: 'mode_model_slots_only_not_physical_lanes',
    mode_model_line_slots: mode,
  };
}

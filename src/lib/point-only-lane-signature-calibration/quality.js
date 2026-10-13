import { LIMITS } from './constants.js';

export function signatureQualityResult(sig) {
  const failures = [];
  if (!sig.has_left_edge || !sig.has_right_edge) failures.push('missing_road_edge');
  if (sig.lane_point_count < 1) failures.push('no_lane_points');
  if ((sig.pose_distance_m ?? 99) > LIMITS.qualityMaxDistanceM) failures.push('pose_distance_high');
  if ((sig.pose_heading_diff_deg ?? 180) > LIMITS.qualityMaxHeadingDeg) failures.push('heading_misaligned');
  const hasStrongLanePoint = (sig.sorted_lane_probabilities || []).some(
    (p) => p >= LIMITS.minLaneProbability
  );
  if (!hasStrongLanePoint) failures.push('lane_probability_low');
  const edgeMin = Math.min(
    sig.left_edge_probability ?? 0,
    sig.right_edge_probability ?? 0
  );
  if (edgeMin < LIMITS.minEdgeProbability) failures.push('edge_probability_low');
  if (sig.road_width_model_m != null && (sig.road_width_model_m < 2.5 || sig.road_width_model_m > 22)) {
    failures.push('road_width_implausible');
  }
  const pass = failures.length === 0;
  const score =
    (pass ? 1 : 0.2) *
    (1 - Math.min(1, (sig.pose_distance_m ?? 8) / LIMITS.qualityMaxDistanceM)) *
    (1 - Math.min(1, (sig.pose_heading_diff_deg ?? 30) / LIMITS.qualityMaxHeadingDeg)) *
    (0.4 + 0.6 * sig.mean_lane_probability);
  return {
    pass,
    failures,
    quality_score: Math.round(score * 1000) / 1000,
  };
}

export function selectBestQualityFrame(frames) {
  const ranked = frames
    .map((fr) => ({ fr, q: signatureQualityResult(fr.signature) }))
    .filter((x) => x.q.pass)
    .sort((a, b) => b.q.quality_score - a.q.quality_score);
  return ranked[0]?.fr ?? null;
}

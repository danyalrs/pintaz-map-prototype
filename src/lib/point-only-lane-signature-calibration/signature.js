import { LIMITS } from './constants.js';

/**
 * Point-only frame signature. Sorted by vehicle-frame lateral (model_y_m).
 * lane_index is retained only for traceability — never used as a feature dimension.
 */
export function buildFrameSignature({ pose, lanePoints, edgePoints }) {
  const lanes = (lanePoints || [])
    .map((p) => ({
      model_y_m: p.model_y_m,
      probability: p.lane_probability ?? 0,
      lane_index_trace: p.lane_index ?? null,
    }))
    .filter((p) => p.probability >= LIMITS.minLaneProbability * 0.5)
    .sort((a, b) => a.model_y_m - b.model_y_m);

  const edges = (edgePoints || [])
    .map((p) => ({
      model_y_m: p.model_y_m,
      probability: p.edge_probability ?? 0,
      edge_index_trace: p.edge_index ?? null,
    }))
    .filter((p) => p.probability >= LIMITS.minEdgeProbability * 0.5)
    .sort((a, b) => a.model_y_m - b.model_y_m);

  const leftEdge = edges[0] ?? null;
  const rightEdge = edges.length > 1 ? edges[edges.length - 1] : null;
  const roadWidth =
    leftEdge && rightEdge ? Math.abs(rightEdge.model_y_m - leftEdge.model_y_m) : null;

  const spacings = [];
  const laterals = [...lanes.map((l) => l.model_y_m)];
  if (leftEdge) laterals.unshift(leftEdge.model_y_m);
  if (rightEdge) laterals.push(rightEdge.model_y_m);
  laterals.sort((a, b) => a - b);
  for (let i = 1; i < laterals.length; i++) spacings.push(laterals[i] - laterals[i - 1]);

  const laneProbs = lanes.map((l) => l.probability);
  const poseDistance = pose?.distance_m ?? null;
  const headingDiff = pose?.heading_diff_deg ?? null;

  return {
    lane_point_count: lanes.length,
    edge_point_count: edges.length,
    has_left_edge: Boolean(leftEdge),
    has_right_edge: Boolean(rightEdge),
    sorted_lane_model_y_m: lanes.map((l) => l.model_y_m),
    sorted_lane_probabilities: laneProbs,
    left_edge_model_y_m: leftEdge?.model_y_m ?? null,
    right_edge_model_y_m: rightEdge?.model_y_m ?? null,
    left_edge_probability: leftEdge?.probability ?? null,
    right_edge_probability: rightEdge?.probability ?? null,
    lane_to_edge_spacings_m: spacings,
    road_width_model_m: roadWidth,
    pose_distance_m: poseDistance,
    pose_heading_diff_deg: headingDiff,
    mean_lane_probability: laneProbs.length ? laneProbs.reduce((a, b) => a + b, 0) / laneProbs.length : 0,
    min_lane_probability: laneProbs.length ? Math.min(...laneProbs) : 0,
    max_lane_probability: laneProbs.length ? Math.max(...laneProbs) : 0,
  };
}

export function signatureToFeatureVector(sig) {
  const pad = (arr, n, fill = 0) => {
    const out = [...arr];
    while (out.length < n) out.push(fill);
    return out.slice(0, n);
  };
  const normY = (y) => (y == null ? 0 : y / 12);
  const normSpacing = (s) => s / 6;
  return [
    sig.lane_point_count / LIMITS.maxLaneSlots,
    sig.edge_point_count / LIMITS.maxEdgeSlots,
    sig.has_left_edge ? 1 : 0,
    sig.has_right_edge ? 1 : 0,
    ...pad(sig.sorted_lane_model_y_m.map(normY), LIMITS.maxLaneSlots),
    ...pad(sig.sorted_lane_probabilities, LIMITS.maxLaneSlots, 0),
    normY(sig.left_edge_model_y_m),
    normY(sig.right_edge_model_y_m),
    sig.left_edge_probability ?? 0,
    sig.right_edge_probability ?? 0,
    ...pad(sig.lane_to_edge_spacings_m.map(normSpacing), LIMITS.maxLaneSlots + 1, 0),
    sig.road_width_model_m == null ? 0 : sig.road_width_model_m / 14,
    (sig.pose_distance_m ?? 12) / 12,
    (sig.pose_heading_diff_deg ?? 90) / 90,
    sig.mean_lane_probability,
    sig.min_lane_probability,
    sig.max_lane_probability,
  ];
}

export function injectLowProbabilityFalseLanePoint(sig, lateral = 0.25) {
  const lanePoints = sig.sorted_lane_model_y_m.map((y, i) => ({
    model_y_m: y,
    lane_probability: sig.sorted_lane_probabilities[i],
    lane_index: i,
  }));
  lanePoints.push({ model_y_m: lateral, lane_probability: 0.12, lane_index: 99 });
  return buildFrameSignature({
    pose: { distance_m: sig.pose_distance_m, heading_diff_deg: sig.pose_heading_diff_deg },
    lanePoints,
    edgePoints: buildEdgePointsFromSig(sig),
  });
}

export function dropRoadEdgesFromSignature(sig) {
  return buildFrameSignature({
    pose: { distance_m: sig.pose_distance_m, heading_diff_deg: sig.pose_heading_diff_deg },
    lanePoints: sig.sorted_lane_model_y_m.map((y, i) => ({
      model_y_m: y,
      lane_probability: sig.sorted_lane_probabilities[i],
      lane_index: i,
    })),
    edgePoints: [],
  });
}

function buildEdgePointsFromSig(sig) {
  const pts = [];
  if (sig.left_edge_model_y_m != null) {
    pts.push({
      model_y_m: sig.left_edge_model_y_m,
      edge_probability: sig.left_edge_probability ?? 0.9,
      edge_index: 0,
    });
  }
  if (sig.right_edge_model_y_m != null) {
    pts.push({
      model_y_m: sig.right_edge_model_y_m,
      edge_probability: sig.right_edge_probability ?? 0.9,
      edge_index: 1,
    });
  }
  return pts;
}

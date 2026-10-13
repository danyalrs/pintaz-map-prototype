import { LIMITS } from './constants.js';
import { OUTCOME } from './constants.js';

function perFrameLaneCounts(acceptedFrames, leftEdge, rightEdge) {
  const counts = [];
  for (const fr of acceptedFrames) {
    const interiors = fr.lane_point_lateral_m
      .map((p) => p.lateral_m)
      .filter((v) => v > leftEdge + 0.5 && v < rightEdge - 0.5);
    const uniq = new Set(
      interiors.map((v) => Math.round(v / LIMITS.clusterBinM))
    );
    const boundaries = uniq.size;
    const lanes = boundaries + 1;
    if (lanes >= 1 && lanes <= 6) counts.push(lanes);
  }
  return counts;
}

export function deriveLaneHypothesis({
  clusters,
  acceptedFrames,
  osmLaneCountForEvalOnly,
  missingOsmLanes,
}) {
  const { lane_boundaries, road_edges } = clusters;
  if (road_edges.length < 2) {
    return {
      selected_lane_count: null,
      confidence: 0,
      outcome: OUTCOME.INSUFFICIENT_EVIDENCE,
      note: 'No stable left/right road-edge clusters from edge_point geometry.',
    };
  }
  const leftEdge = road_edges[0].center_lateral_m;
  const rightEdge = road_edges[road_edges.length - 1].center_lateral_m;
  const width = rightEdge - leftEdge;
  if (width < LIMITS.minRoadWidthM || width > LIMITS.maxRoadWidthM) {
    return {
      selected_lane_count: null,
      confidence: 0,
      outcome: OUTCOME.INSUFFICIENT_EVIDENCE,
      note: 'Road-edge span implausible for cross-section.',
    };
  }

  const interiorBoundaries = lane_boundaries.filter(
    (c) => c.center_lateral_m > leftEdge + 0.6 && c.center_lateral_m < rightEdge - 0.6
  );
  const frameCounts = perFrameLaneCounts(acceptedFrames, leftEdge, rightEdge);
  if (!frameCounts.length) {
    return {
      selected_lane_count: null,
      confidence: 0,
      outcome: OUTCOME.INSUFFICIENT_EVIDENCE,
      note: 'No per-frame lane intervals computed.',
    };
  }
  const freq = new Map();
  for (const c of frameCounts) freq.set(c, (freq.get(c) || 0) + 1);
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const [mode, modeCount] = sorted[0];
  const agreement = modeCount / frameCounts.length;
  if (agreement < LIMITS.consensusFrameFraction || modeCount < LIMITS.minClusterSupportFrames) {
    return {
      selected_lane_count: null,
      confidence: Math.round(agreement * 100) / 100,
      outcome: OUTCOME.INSUFFICIENT_EVIDENCE,
      note: 'Lane-count mode unstable across accepted frames.',
      competing_configurations: sorted,
    };
  }
  const laneWidth = width / mode;
  if (laneWidth < LIMITS.minLaneWidthM || laneWidth > LIMITS.maxLaneWidthM) {
    return {
      selected_lane_count: null,
      confidence: agreement,
      outcome: OUTCOME.INSUFFICIENT_EVIDENCE,
      note: 'Implied lane width out of plausible range.',
    };
  }
  if (sorted.length > 1 && sorted[1][1] / modeCount > 0.4) {
    return {
      selected_lane_count: null,
      confidence: agreement,
      outcome: OUTCOME.INSUFFICIENT_EVIDENCE,
      note: 'Strong competing lane-count configuration.',
      competing_configurations: sorted,
    };
  }

  const result = {
    selected_lane_count: mode,
    confidence: Math.round(agreement * 100) / 100,
    interior_boundary_clusters: interiorBoundaries.length,
    implied_lane_width_m: Math.round(laneWidth * 100) / 100,
  };

  if (!missingOsmLanes && osmLaneCountForEvalOnly != null) {
    result.outcome =
      mode === osmLaneCountForEvalOnly
        ? OUTCOME.GEOMETRY_AGREES_WITH_OSM_BASELINE
        : OUTCOME.GEOMETRY_DISAGREES_WITH_OSM_REVIEW;
    return result;
  }
  result.outcome = OUTCOME.GEOMETRY_CANDIDATE_MISSING_OSM_LANES;
  return result;
}

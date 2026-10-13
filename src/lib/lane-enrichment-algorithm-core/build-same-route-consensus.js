import { LIMITS, FEATURE_TYPE } from './constants.js';

function clusterLaterals(samples, kind) {
  const bins = new Map();
  for (const s of samples) {
    const key = Math.round(s.lateral_m / LIMITS.clusterBinM);
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(s);
  }
  const clusters = [];
  for (const [, members] of bins) {
    const frameIds = new Set(members.map((m) => m.frame_id));
    if (frameIds.size < LIMITS.minClusterSupportFrames) continue;
    const laterals = members.map((m) => m.lateral_m);
    const center = laterals.reduce((a, b) => a + b, 0) / laterals.length;
    clusters.push({
      kind,
      center_lateral_m: Math.round(center * 1000) / 1000,
      support_frame_count: frameIds.size,
    });
  }
  clusters.sort((a, b) => a.center_lateral_m - b.center_lateral_m);
  return clusters;
}

export function buildSameRouteConsensus(frameEvidence) {
  const accepted = frameEvidence.filter((f) => f.accepted);
  const laneSamples = [];
  const edgeSamples = [];
  for (const fr of accepted) {
    for (const lb of fr.lane_boundaries) {
      laneSamples.push({ ...lb, frame_id: fr.frame_id });
    }
    for (const re of fr.road_edges) {
      edgeSamples.push({ ...re, frame_id: fr.frame_id });
    }
  }
  const lane_boundaries = clusterLaterals(laneSamples, FEATURE_TYPE.LANE_BOUNDARY);
  const road_edges = clusterLaterals(edgeSamples, FEATURE_TYPE.ROAD_EDGE);
  return { accepted_frames: accepted, lane_boundaries, road_edges, lane_samples: laneSamples };
}

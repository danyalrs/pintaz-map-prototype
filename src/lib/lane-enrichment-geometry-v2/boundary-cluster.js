import { LIMITS } from './constants.js';

function clusterLaterals(samples, kind) {
  const values = samples.map((s) => s.lateral_m).filter((v) => Number.isFinite(v));
  if (!values.length) return [];
  const bins = new Map();
  for (const s of samples) {
    if (!Number.isFinite(s.lateral_m)) continue;
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
    const spread = Math.max(...laterals) - Math.min(...laterals);
    clusters.push({
      kind,
      center_lateral_m: Math.round(center * 1000) / 1000,
      lateral_spread_m: Math.round(spread * 1000) / 1000,
      support_frame_count: frameIds.size,
      sample_count: members.length,
    });
  }
  clusters.sort((a, b) => a.center_lateral_m - b.center_lateral_m);
  return clusters;
}

export function clusterBoundaries(acceptedFrames) {
  const laneSamples = [];
  const edgeSamples = [];
  for (const fr of acceptedFrames) {
    for (const lp of fr.lane_point_lateral_m) {
      laneSamples.push({ ...lp, frame_id: fr.frame_id });
    }
    for (const ep of fr.edge_point_lateral_m) {
      edgeSamples.push({ ...ep, frame_id: fr.frame_id });
    }
  }
  const lane_boundaries = clusterLaterals(laneSamples, 'lane_boundary');
  const road_edges = clusterLaterals(edgeSamples, 'road_edge');
  return { lane_boundaries, road_edges };
}

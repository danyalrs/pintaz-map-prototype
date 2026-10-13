import { LIMITS } from './constants.js';

export function perFrameLaneHypothesis(frameRecord) {
  const sorted = [...(frameRecord.road_edges || [])].sort((a, b) => a.lateral_m - b.lateral_m);
  if (sorted.length < 2) return null;
  const left = sorted[0].lateral_m;
  const right = sorted[sorted.length - 1].lateral_m;
  const width = right - left;
  if (width < LIMITS.minRoadWidthM || width > LIMITS.maxRoadWidthM) return null;
  const interiors = (frameRecord.lane_boundaries || [])
    .map((p) => p.lateral_m)
    .filter((v) => v > left + 0.4 && v < right - 0.4);
  const bins = new Set(interiors.map((v) => Math.round(v / LIMITS.clusterBinM)));
  const lanes = bins.size + 1;
  if (lanes < 1 || lanes > 8) return null;
  const laneWidth = width / lanes;
  if (laneWidth < LIMITS.minLaneWidthM || laneWidth > LIMITS.maxLaneWidthM) return null;
  return { frame_id: frameRecord.frame_id, lanes, width, left, right };
}

export function isHighQualityObservationFrame(frameRecord) {
  if ((frameRecord.pose_quality ?? 1) < LIMITS.singleFrameMinPoseQuality) return false;
  const lines = [...(frameRecord.lane_boundaries || []), ...(frameRecord.road_edges || [])];
  if (lines.length < 2) return false;
  return lines.every((x) => (x.probability ?? 1) >= LIMITS.strongGroupMinLineProbability);
}

export function detectStrongCompetingLaneCountHypotheses(acceptedFrames) {
  const groups = new Map();
  for (const fr of acceptedFrames) {
    if (!isHighQualityObservationFrame(fr)) continue;
    const hyp = perFrameLaneHypothesis(fr);
    if (!hyp) continue;
    if (!groups.has(hyp.lanes)) groups.set(hyp.lanes, []);
    groups.get(hyp.lanes).push(fr.frame_id);
  }
  const strong = [...groups.entries()]
    .filter(([, frameIds]) => frameIds.length >= LIMITS.minStrongGroupFrames)
    .map(([lanes, frameIds]) => ({ lanes, frame_ids: frameIds, support: frameIds.length }));
  if (strong.length >= 2) {
    return { competing: true, strong_groups: strong };
  }
  return { competing: false, strong_groups: strong };
}

export function resolveRoadEdgeWindow(consensus, acceptedFrames) {
  const clustered = consensus.road_edges || [];
  if (clustered.length >= 2) {
    return {
      leftEdge: clustered[0].center_lateral_m,
      rightEdge: clustered[clustered.length - 1].center_lateral_m,
      edgeSource: 'temporal_cluster',
    };
  }
  if (acceptedFrames.length === 1) {
    const fr = acceptedFrames[0];
    const sorted = [...(fr.road_edges || [])].sort((a, b) => a.lateral_m - b.lateral_m);
    if (sorted.length >= 2) {
      return {
        leftEdge: sorted[0].lateral_m,
        rightEdge: sorted[sorted.length - 1].lateral_m,
        edgeSource: 'single_frame',
      };
    }
  }
  return null;
}

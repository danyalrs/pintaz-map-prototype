import { LIMITS, FEATURE_TYPE } from './constants.js';
import { intersectLineWithCrossSection } from './intersect-line-with-cross-section.js';

export function buildFrameBoundaryEvidence(frames, crossSection) {
  const records = [];
  for (const fr of frames || []) {
    const rejection = [];
    if (fr.pose_quality != null && fr.pose_quality < LIMITS.minPoseQuality) {
      rejection.push('poor_pose_quality');
    }
    if (fr.heading_aligned === false) rejection.push('wrong_travel_direction');

    const laneHits = [];
    const edgeHits = [];
    for (const line of fr.lines || []) {
      if (line.probability != null && line.probability < LIMITS.minLineConfidence) {
        continue;
      }
      const verts = line.coordinates_local_m || line.vertices;
      const ix = intersectLineWithCrossSection(verts, crossSection);
      if (!ix.ok) {
        rejection.push(`${ix.reason}:${line.line_id}`);
        continue;
      }
      const row = {
        line_id: line.line_id,
        feature_type: line.feature_type,
        lateral_m: ix.lateral_m,
        probability: line.probability ?? 1,
      };
      if (line.feature_type === FEATURE_TYPE.ROAD_EDGE) edgeHits.push(row);
      else laneHits.push(row);
    }

    const accepted = rejection.length === 0 && (laneHits.length > 0 || edgeHits.length >= 2);
    if (!edgeHits.length && !laneHits.length) rejection.push('no_valid_intersections');
    records.push({
      frame_id: fr.frame_id,
      pose_quality: fr.pose_quality,
      heading_aligned: fr.heading_aligned,
      accepted,
      rejection_reasons: rejection,
      lane_boundaries: laneHits,
      road_edges: edgeHits,
    });
  }
  return records;
}

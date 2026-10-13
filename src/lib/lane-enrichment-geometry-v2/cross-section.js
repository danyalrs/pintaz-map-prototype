import { createHash } from 'node:crypto';
import { LIMITS } from './constants.js';
import { findStraightSegments, poseNearSegment } from './local-project.js';

export const EXCLUSION = {
  NOT_ONE_WAY: 'not_one_way',
  NO_STRAIGHT_SEGMENT: 'no_straight_non_junction_segment',
  SHARP_CURVE: 'sharp_curve_near_cross_section',
  JUNCTION_SPLIT_MERGE: 'junction_split_or_merge_proximity',
  INSUFFICIENT_ROUTE_COVERAGE: 'insufficient_route_coverage',
  WRONG_TRAVEL_DIRECTION: 'wrong_travel_direction',
  POOR_POSE_ALIGNMENT: 'poor_pose_alignment',
};

export function isOneWayWay(feature, roadIndexEntry) {
  const raw = feature?.properties?.oneway;
  if (raw === 'yes' || raw === '1' || raw === true) return true;
  if (roadIndexEntry?.oneway?.isOneway) return true;
  return false;
}

export function selectCrossSections(osmWayId, coords, posesOnWay) {
  if (!coords || coords.length < 2) {
    return { sections: [], exclusions: [EXCLUSION.NO_STRAIGHT_SEGMENT] };
  }
  const straight = findStraightSegments(coords, LIMITS.maxSharpestTurnDeg).filter(
    (s) => s.length_m >= LIMITS.minStraightSegmentM
  );
  if (!straight.length) {
    return { sections: [], exclusions: [EXCLUSION.NO_STRAIGHT_SEGMENT, EXCLUSION.SHARP_CURVE] };
  }
  const sections = [];
  for (const seg of straight) {
    const nearPoses = [];
    for (const p of posesOnWay) {
      const hd = p.properties?.heading_diff_deg;
      if (hd != null && hd > LIMITS.maxHeadingDiffDeg) continue;
      const dm = p.properties?.distance_m;
      if (dm != null && dm > LIMITS.maxPoseDistanceM) continue;
      const near = poseNearSegment(p, seg, LIMITS.crossSectionAlongToleranceM);
      if (near) nearPoses.push({ pose: p, ...near });
    }
    if (nearPoses.length < LIMITS.minClusterSupportFrames) {
      continue;
    }
    const id = createHash('sha256')
      .update(`${osmWayId}:${seg.index}:${seg.a.join(',')}:${seg.b.join(',')}`)
      .digest('hex')
      .slice(0, 16);
    sections.push({
      cross_section_id: id,
      segment_index: seg.index,
      anchor: [
        (seg.a[0] + seg.b[0]) / 2,
        (seg.a[1] + seg.b[1]) / 2,
      ],
      segment_endpoints: { a: seg.a, b: seg.b },
      bearing_deg: seg.bearing_deg,
      length_m: seg.length_m,
      matched_pose_count: nearPoses.length,
      pose_samples: nearPoses,
    });
  }
  const exclusions = [];
  if (!sections.length) {
    exclusions.push(EXCLUSION.INSUFFICIENT_ROUTE_COVERAGE);
    if (straight.length) exclusions.push(EXCLUSION.POOR_POSE_ALIGNMENT);
  }
  return { sections, exclusions };
}

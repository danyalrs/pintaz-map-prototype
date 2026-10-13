import { haversineMetres } from '../geo-square.js';
import { FRAME_LIMITS } from './constants.js';

export function rejectFrameReason(poseProps, context = {}) {
  const reasons = [];
  const d = poseProps.distance_m;
  if (d != null && d > FRAME_LIMITS.maxPoseToOsmDistanceM) {
    reasons.push('too_far_from_osm_way');
  }
  const hd = poseProps.heading_diff_deg;
  if (hd != null && hd > FRAME_LIMITS.maxHeadingDiffDeg) {
    reasons.push('wrong_direction_or_heading_mismatch');
  }
  if (poseProps.bridge || poseProps.tunnel) {
    reasons.push('bridge_or_tunnel_context');
  }
  if (context.sharp_bend) {
    reasons.push('sharp_bend');
  }
  if (context.near_junction) {
    reasons.push('near_junction_or_merge');
  }
  if (context.missing_lane_edge) {
    reasons.push('missing_lane_or_edge_observations_for_frame');
  }
  if (context.isolated_pose) {
    reasons.push('isolated_from_nearby_same_route_poses');
  }
  return reasons;
}

export function detectSharpBend(poseRun) {
  if (!poseRun || poseRun.length < 3) return false;
  const headings = poseRun.map((p) => p.properties?.heading_deg ?? p.properties?.segment_heading_deg).filter((v) => v != null);
  if (headings.length < 3) return false;
  let maxDelta = 0;
  for (let i = 1; i < headings.length; i++) {
    const d = Math.abs(((headings[i] - headings[i - 1] + 540) % 360) - 180);
    maxDelta = Math.max(maxDelta, d);
  }
  return maxDelta > 35;
}

export function detectIsolatedPose(pose, allPosesOnWay) {
  const [lon, lat] = pose.geometry.coordinates;
  let neighbours = 0;
  for (const other of allPosesOnWay) {
    if (other === pose) continue;
    const gap = haversineMetres(lon, lat, other.geometry.coordinates[0], other.geometry.coordinates[1]);
    if (gap <= FRAME_LIMITS.maxAlongGapM) neighbours += 1;
  }
  return neighbours === 0 && allPosesOnWay.length > 1;
}

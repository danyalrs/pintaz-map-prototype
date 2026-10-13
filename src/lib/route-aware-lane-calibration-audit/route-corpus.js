import { loadLabelledWayCorpus, isLabelledOneWayRoadIndexEntry } from '../point-only-lane-signature-calibration/corpus.js';
import { LIMITS } from '../point-only-lane-signature-calibration/constants.js';
import { signatureQualityResult } from '../point-only-lane-signature-calibration/quality.js';

export function loadRouteScopedWays(routeKey) {
  const { ways, roadIndex, routesLoaded } = loadLabelledWayCorpus();
  const bundle_ok = routesLoaded.includes(routeKey);
  const scoped = new Map();
  for (const [wayId, w] of ways) {
    const frames = w.frames.filter((f) => f.route_key === routeKey);
    if (!frames.length) continue;
    scoped.set(wayId, {
      ...w,
      frames,
      frame_count: frames.length,
      route_keys: [routeKey],
    });
  }
  return { ways: scoped, roadIndex, bundle_ok };
}

export function eligibleLabelledWaysOnRoute(waysMap) {
  return [...waysMap.values()].filter(
    (w) =>
      w.labelled_one_way &&
      w.osm_lane_count != null &&
      w.frames.length >= LIMITS.minFramesPerWay
  );
}

export function labelledOneWayWaysOnRoute(waysMap) {
  return [...waysMap.values()].filter((w) => w.labelled_one_way && w.osm_lane_count != null);
}

export function unknownLaneWaysOnRoute(waysMap, roadIndex) {
  return [...waysMap.values()].filter((w) => {
    const entry = roadIndex?.by_osm_id?.[w.osm_way_id];
    if (!entry) return true;
    return entry.lane_count_source === 'lane_count_unknown' || entry.lane_count_total == null;
  });
}

export function routeSourceQualitySummary(waysMap, { labelledOnly = true } = {}) {
  const ways = labelledOnly ? labelledOneWayWaysOnRoute(waysMap) : [...waysMap.values()];
  let totalFrames = 0;
  let acceptedFrames = 0;
  let sumDistance = 0;
  let sumHeading = 0;
  for (const w of ways) {
    for (const fr of w.frames) {
      totalFrames += 1;
      const q = signatureQualityResult(fr.signature);
      if (q.pass) acceptedFrames += 1;
      sumDistance += fr.signature.pose_distance_m ?? 0;
      sumHeading += fr.signature.pose_heading_diff_deg ?? 0;
    }
  }
  return {
    matched_frame_count: totalFrames,
    accepted_frame_count: acceptedFrames,
    accepted_frame_fraction: totalFrames ? acceptedFrames / totalFrames : 0,
    mean_pose_distance_m: totalFrames ? sumDistance / totalFrames : null,
    mean_heading_diff_deg: totalFrames ? sumHeading / totalFrames : null,
  };
}

export function isUnknownLaneWay(roadIndex, wayId) {
  const entry = roadIndex?.by_osm_id?.[wayId];
  if (!entry) return true;
  return !isLabelledOneWayRoadIndexEntry(entry);
}

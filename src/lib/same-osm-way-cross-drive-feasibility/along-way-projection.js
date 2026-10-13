import { projectAlongCentreline } from '../mismatch-projection.js';
import { MAX_PROJECTION_DISTANCE_M } from './config.js';

/**
 * Diagnostic along-way projection on a single OSM centreline (read-only).
 */
export function projectPoseOnWay(lon, lat, centreCoords, prevChainS = null) {
  if (!centreCoords || centreCoords.length < 2) {
    return { ok: false, reason: 'missing_geometry' };
  }
  const proj = projectAlongCentreline(lon, lat, centreCoords);
  if (!proj) return { ok: false, reason: 'no_projection' };
  if (proj.distanceM > MAX_PROJECTION_DISTANCE_M) {
    return { ok: false, reason: 'projection_too_far', distance_m: proj.distanceM };
  }

  const ambiguous = findAmbiguousProjection(lon, lat, centreCoords, proj.distanceM);
  if (ambiguous) {
    return { ok: false, reason: 'ambiguous_nearest_point', distance_m: proj.distanceM };
  }

  if (prevChainS != null && proj.chainS < prevChainS - 12) {
    return { ok: false, reason: 'non_monotonic_s', chain_s: proj.chainS, prev_chain_s: prevChainS };
  }

  return {
    ok: true,
    chain_s: proj.chainS,
    lateral_m: proj.lateralM,
    distance_m: proj.distanceM,
    segment_index: proj.segmentIndex,
  };
}

function findAmbiguousProjection(lon, lat, centreCoords, bestDist) {
  let hits = 0;
  const tol = Math.max(0.35, bestDist + 0.25);
  for (let i = 0; i < centreCoords.length - 1; i++) {
    const [aLon, aLat] = centreCoords[i];
    const [bLon, bLat] = centreCoords[i + 1];
    const d = pointSegDist(lon, lat, aLon, aLat, bLon, bLat);
    if (d <= tol) hits += 1;
    if (hits >= 2) return true;
  }
  return false;
}

function pointSegDist(px, py, ax, ay, bx, by) {
  const proj = projectAlongCentreline(px, py, [[ax, ay], [bx, by]]);
  return proj?.distanceM ?? Infinity;
}

export function travelDirectionSign(headingDiffDeg) {
  const h = Number(headingDiffDeg);
  if (!Number.isFinite(h)) return 0;
  if (h <= 90) return 1;
  return -1;
}

import { bearingDeg, pointToSegmentMetres } from '../geo-segment.js';
import { haversineMetres } from '../geo-square.js';

function metresPerDegree(lat) {
  const latRad = (lat * Math.PI) / 180;
  const mPerDegLat = 111132.954 - 559.822 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad);
  const mPerDegLon = mPerDegLat * Math.cos(latRad);
  return { mPerDegLat, mPerDegLon };
}

export function lonLatToLocalM(lon, lat, originLon, originLat) {
  const { mPerDegLat, mPerDegLon } = metresPerDegree(originLat);
  return { x: (lon - originLon) * mPerDegLon, y: (lat - originLat) * mPerDegLat };
}

/** Signed lateral metres: positive = left of forward travel along segment A→B. */
export function signedLateralM(lon, lat, aLon, aLat, bLon, bLat) {
  const originLon = (aLon + bLon) / 2;
  const originLat = (aLat + bLat) / 2;
  const a = lonLatToLocalM(aLon, aLat, originLon, originLat);
  const b = lonLatToLocalM(bLon, bLat, originLon, originLat);
  const p = lonLatToLocalM(lon, lat, originLon, originLat);
  const fx = b.x - a.x;
  const fy = b.y - a.y;
  const len = Math.hypot(fx, fy) || 1;
  const nx = -fy / len;
  const ny = fx / len;
  const vx = p.x - a.x;
  const vy = p.y - a.y;
  return vx * nx + vy * ny;
}

export function segmentLengthM(a, b) {
  return haversineMetres(a[0], a[1], b[0], b[1]);
}

export function findStraightSegments(coords, maxTurnDeg) {
  const segments = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const len = segmentLengthM(a, b);
    if (len < 8) continue;
    let turn = 0;
    if (i > 0) {
      const b0 = bearingDeg(coords[i - 1][0], coords[i - 1][1], a[0], a[1]);
      const b1 = bearingDeg(a[0], a[1], b[0], b[1]);
      turn = Math.abs(((b1 - b0 + 540) % 360) - 180);
    }
    if (i < coords.length - 2) {
      const b1 = bearingDeg(a[0], a[1], b[0], b[1]);
      const b2 = bearingDeg(b[0], b[1], coords[i + 2][0], coords[i + 2][1]);
      turn = Math.max(turn, Math.abs(((b2 - b1 + 540) % 360) - 180));
    }
    if (turn <= maxTurnDeg) {
      segments.push({
        index: i,
        a,
        b,
        length_m: len,
        bearing_deg: bearingDeg(a[0], a[1], b[0], b[1]),
        turn_at_joint_deg: turn,
      });
    }
  }
  return segments;
}

export function poseNearSegment(pose, seg, alongToleranceM) {
  const [lon, lat] = pose.geometry.coordinates;
  const { alongM, distanceM, t } = pointToSegmentMetres(
    lon,
    lat,
    seg.a[0],
    seg.a[1],
    seg.b[0],
    seg.b[1]
  );
  if (t < 0 || t > 1) return null;
  if (distanceM > alongToleranceM) return null;
  return { along_m: alongM, distance_to_centerline_m: distanceM, t };
}

import { haversineMetres } from './geo-square.js';

/** Max miter length as multiple of half-width (documented gate). */
export const MITER_LIMIT = 2.5;
/** Allowed metres beyond half-width for any surface vertex. */
export const VERTEX_DISTANCE_TOLERANCE_M = 0.35;
/** Endpoint cap beyond centreline end (documented). */
export const END_CAP_EXTENSION_M = 0.25;
export const MIN_SOURCE_SEGMENT_M = 1.5;
export const DEDUPE_COORD_METRES = 0.05;
/** Upper bound catches triangular spike / bow-tie expansion artefacts. */
export const AREA_RATIO_MAX = 1.65;

function metresPerDegree(lat) {
  const latRad = (lat * Math.PI) / 180;
  const mPerDegLat = 111132.954 - 559.822 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad);
  const mPerDegLon = mPerDegLat * Math.cos(latRad);
  return { mPerDegLat, mPerDegLon };
}

export function bearingDeg(lon1, lat1, lon2, lat2) {
  const lat1r = (lat1 * Math.PI) / 180;
  const lat2r = (lat2 * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2r);
  const x = Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function offsetPoint(lon, lat, bearing, distanceM, side) {
  const { mPerDegLat, mPerDegLon } = metresPerDegree(lat);
  const rad = ((bearing + (side === 'left' ? -90 : 90)) * Math.PI) / 180;
  const dLon = (Math.sin(rad) * distanceM) / mPerDegLon;
  const dLat = (Math.cos(rad) * distanceM) / mPerDegLat;
  return [lon + dLon, lat + dLat];
}

export function lineLengthM(coords) {
  let len = 0;
  for (let i = 1; i < coords.length; i++) {
    len += haversineMetres(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return len;
}

export function dedupeCoordinates(coords, minDistM = DEDUPE_COORD_METRES) {
  if (!coords?.length) return [];
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const prev = out[out.length - 1];
    const d = haversineMetres(prev[0], prev[1], coords[i][0], coords[i][1]);
    if (d >= minDistM) out.push(coords[i]);
  }
  if (out.length === 1 && coords.length > 1) out.push(coords[coords.length - 1]);
  return out;
}

export function sharpestTurnDeg(coords) {
  if (!coords || coords.length < 3) return 0;
  let maxTurn = 0;
  for (let i = 1; i < coords.length - 1; i++) {
    const b1 = bearingDeg(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
    const b2 = bearingDeg(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
    let diff = Math.abs(b2 - b1);
    if (diff > 180) diff = 360 - diff;
    maxTurn = Math.max(maxTurn, diff);
  }
  return maxTurn;
}

function lonLatToLocalM(lon, lat, originLon, originLat) {
  const { mPerDegLat, mPerDegLon } = metresPerDegree(originLat);
  return [(lon - originLon) * mPerDegLon, (lat - originLat) * mPerDegLat];
}

function polygonAreaM2(ring) {
  if (!ring || ring.length < 4) return 0;
  const oLon = ring[0][0];
  const oLat = ring[0][1];
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = lonLatToLocalM(ring[i][0], ring[i][1], oLon, oLat);
    const [x2, y2] = lonLatToLocalM(ring[i + 1][0], ring[i + 1][1], oLon, oLat);
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function segmentsIntersect2d(a1, a2, b1, b2) {
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const onSeg = (p, q, r) =>
    Math.min(p[0], r[0]) <= q[0] &&
    q[0] <= Math.max(p[0], r[0]) &&
    Math.min(p[1], r[1]) <= q[1] &&
    q[1] <= Math.max(p[1], r[1]);
  const d1 = cross(a1, a2, b1);
  const d2 = cross(a1, a2, b2);
  const d3 = cross(b1, b2, a1);
  const d4 = cross(b1, b2, a2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && onSeg(a1, b1, a2)) return true;
  if (d2 === 0 && onSeg(a1, b2, a2)) return true;
  if (d3 === 0 && onSeg(b1, a1, b2)) return true;
  if (d4 === 0 && onSeg(b1, a2, b2)) return true;
  return false;
}

export function ringSelfIntersects(ring) {
  const n = ring.length - 1;
  if (n < 4) return false;
  const pts = ring.map(([lon, lat]) => lonLatToLocalM(lon, lat, ring[0][0], ring[0][1]));
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 2; j < n - 1; j++) {
      if (i === 0 && j === n - 2) continue;
      if (segmentsIntersect2d(pts[i], pts[i + 1], pts[j], pts[j + 1])) return true;
    }
  }
  return false;
}

export function pointToSegmentDistanceM(px, py, ax, ay, bx, by) {
  const { mPerDegLat, mPerDegLon } = metresPerDegree(py);
  const mx = (px - ax) * mPerDegLon;
  const my = (py - ay) * mPerDegLat;
  const sx = (bx - ax) * mPerDegLon;
  const sy = (by - ay) * mPerDegLat;
  const len2 = sx * sx + sy * sy;
  if (len2 < 1e-9) return Math.hypot(mx, my);
  let t = (mx * sx + my * sy) / len2;
  t = Math.max(0, Math.min(1, t));
  const dx = mx - sx * t;
  const dy = my - sy * t;
  return Math.hypot(dx, dy);
}

export function maxDistanceToCentrelineM(ring, centreCoords) {
  let maxD = 0;
  const open = ring[ring.length - 1][0] === ring[0][0] && ring[ring.length - 1][1] === ring[0][1]
    ? ring.slice(0, -1)
    : ring;
  for (const [lon, lat] of open) {
    let minD = Infinity;
    for (let i = 0; i < centreCoords.length - 1; i++) {
      const d = pointToSegmentDistanceM(
        lon,
        lat,
        centreCoords[i][0],
        centreCoords[i][1],
        centreCoords[i + 1][0],
        centreCoords[i + 1][1]
      );
      if (d < minD) minD = d;
    }
    if (minD > maxD) maxD = minD;
  }
  return maxD;
}

/** Legacy unsafe generator (diagnosis only). */
export function lineStringToRoadSurfaceLegacy(coords, halfWidthM) {
  if (!coords || coords.length < 2 || !Number.isFinite(halfWidthM) || halfWidthM <= 0) return null;
  const left = [];
  const right = [];
  for (let i = 0; i < coords.length; i++) {
    const [lon, lat] = coords[i];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    let bear;
    if (i === 0) bear = bearingDeg(coords[0][0], coords[0][1], coords[1][0], coords[1][1]);
    else if (i === coords.length - 1) {
      bear = bearingDeg(coords[i - 1][0], coords[i - 1][1], lon, lat);
    } else {
      const b1 = bearingDeg(coords[i - 1][0], coords[i - 1][1], lon, lat);
      const b2 = bearingDeg(lon, lat, coords[i + 1][0], coords[i + 1][1]);
      bear = (b1 + b2) / 2;
    }
    left.push(offsetPoint(lon, lat, bear, halfWidthM, 'left'));
    right.push(offsetPoint(lon, lat, bear, halfWidthM, 'right'));
  }
  const ring = [...left, ...right.reverse()];
  if (ring.length < 4) return null;
  ring.push(ring[0]);
  return { type: 'Polygon', coordinates: [ring] };
}

/** Bevel-join strip: per-segment offsets (bounded joins, no averaged bearing miters). */
export function lineStringToRoadSurface(coords, halfWidthM) {
  const clean = dedupeCoordinates(coords);
  if (clean.length < 2 || !Number.isFinite(halfWidthM) || halfWidthM <= 0) return null;
  const left = [];
  const right = [];
  for (let i = 0; i < clean.length - 1; i++) {
    const a = clean[i];
    const b = clean[i + 1];
    const segLen = haversineMetres(a[0], a[1], b[0], b[1]);
    if (segLen < 1e-6) continue;
    const bear = bearingDeg(a[0], a[1], b[0], b[1]);
    if (i === 0) {
      left.push(offsetPoint(a[0], a[1], bear, halfWidthM, 'left'));
      right.push(offsetPoint(a[0], a[1], bear, halfWidthM, 'right'));
    }
    left.push(offsetPoint(b[0], b[1], bear, halfWidthM, 'left'));
    right.push(offsetPoint(b[0], b[1], bear, halfWidthM, 'right'));
  }
  if (left.length < 2 || right.length < 2) return null;
  const ring = [...left, ...right.reverse()];
  ring.push(ring[0]);
  for (const [lon, lat] of ring) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  }
  return { type: 'Polygon', coordinates: [ring] };
}

export function analyseRoadSurfaceCandidate(poly, centreCoords, halfWidthM, lineLengthM) {
  const ring = poly?.coordinates?.[0];
  const expectedArea = lineLengthM * halfWidthM * 2;
  const area = polygonAreaM2(ring);
  const area_ratio = expectedArea > 0 ? area / expectedArea : 0;
  const max_vertex_distance_m = maxDistanceToCentrelineM(ring, centreCoords);
  const max_excess_centreline_m = Math.max(0, max_vertex_distance_m - halfWidthM);
  const self_intersects = ringSelfIntersects(ring);
  const valid_ring =
    ring &&
    ring.length >= 4 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1];
  return {
    area_m2: Math.round(area * 100) / 100,
    expected_area_m2: Math.round(expectedArea * 100) / 100,
    area_ratio: Math.round(area_ratio * 1000) / 1000,
    max_vertex_distance_m: Math.round(max_vertex_distance_m * 1000) / 1000,
    max_excess_centreline_m: Math.round(max_excess_centreline_m * 1000) / 1000,
    self_intersects,
    valid_ring,
  };
}

export function validateRoadSurface(poly, centreCoords, halfWidthM, lineLengthM) {
  const analysis = analyseRoadSurfaceCandidate(poly, centreCoords, halfWidthM, lineLengthM);
  if (!analysis.valid_ring) return { ok: false, reason: 'invalid_ring', analysis };
  if (analysis.self_intersects) return { ok: false, reason: 'self_intersects', analysis };
  const vertexLimitM = halfWidthM + Math.max(VERTEX_DISTANCE_TOLERANCE_M, halfWidthM * 0.5);
  if (analysis.max_vertex_distance_m > vertexLimitM) {
    return { ok: false, reason: 'vertex_beyond_half_width', analysis };
  }
  if (analysis.area_ratio > AREA_RATIO_MAX) {
    return { ok: false, reason: 'implausible_area_ratio_high', analysis };
  }
  if (lineLengthM < MIN_SOURCE_SEGMENT_M) return { ok: false, reason: 'source_too_short', analysis };
  return { ok: true, reason: null, analysis };
}

export function validateDividerLine(divCoords, centreCoords, halfWidthM) {
  if (!divCoords || divCoords.length < 2) return { ok: false, reason: 'degenerate_divider' };
  const limit = halfWidthM + Math.max(VERTEX_DISTANCE_TOLERANCE_M, halfWidthM * 0.5);
  for (const [lon, lat] of divCoords) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return { ok: false, reason: 'non_finite' };
    let minD = Infinity;
    for (let i = 0; i < centreCoords.length - 1; i++) {
      minD = Math.min(
        minD,
        pointToSegmentDistanceM(
          lon,
          lat,
          centreCoords[i][0],
          centreCoords[i][1],
          centreCoords[i + 1][0],
          centreCoords[i + 1][1]
        )
      );
    }
    if (minD > limit) return { ok: false, reason: 'divider_outside_surface' };
  }
  return { ok: true, reason: null };
}

/** Divider offsets from centre: metres left/right (negative = left). */
export function laneDividerOffsets(laneCount, roadWidthM, directionConfidence) {
  if (!laneCount || laneCount < 2) return [];
  const offsets = [];
  const laneW = roadWidthM / laneCount;
  if (directionConfidence === 'total_only') {
    if (laneCount % 2 === 1) offsets.push(0);
    const half = Math.floor(laneCount / 2);
    for (let i = 1; i <= half; i++) {
      offsets.push(-i * laneW);
      offsets.push(i * laneW);
    }
    return [...new Set(offsets.map((x) => Math.round(x * 1000) / 1000))].sort((a, b) => a - b);
  }
  for (let i = 1; i < laneCount; i += 1) {
    const fromLeft = i * laneW - roadWidthM / 2;
    offsets.push(fromLeft);
  }
  return offsets;
}

export function offsetLineFromCentre(coords, offsetM) {
  const clean = dedupeCoordinates(coords);
  if (clean.length < 2) return null;
  const out = [];
  const absOff = Math.abs(offsetM);
  const side = offsetM < 0 ? 'left' : 'right';
  for (let i = 0; i < clean.length - 1; i++) {
    const a = clean[i];
    const b = clean[i + 1];
    const bear = bearingDeg(a[0], a[1], b[0], b[1]);
    if (i === 0) out.push(offsetPoint(a[0], a[1], bear, absOff, side));
    out.push(offsetPoint(b[0], b[1], bear, absOff, side));
  }
  return out.length >= 2 ? out : null;
}

import { bearingDeg, pointToSegmentMetres } from './geo-segment.js';

const DEG = Math.PI / 180;

function localMetres(lon, lat, lon0, lat0) {
  const latRad = lat0 * DEG;
  const mPerDegLat = 111132.954 - 559.822 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad);
  const mPerDegLon = mPerDegLat * Math.cos(latRad);
  return {
    x: (lon - lon0) * mPerDegLon,
    y: (lat - lat0) * mPerDegLat,
  };
}

/** Signed lateral metres: positive = right of forward travel along segment heading. */
export function signedLateralM(lon, lat, segHeadingDeg, refLon, refLat) {
  const lon0 = (lon + refLon) / 2;
  const lat0 = (lat + refLat) / 2;
  const p = localMetres(lon, lat, lon0, lat0);
  const r = localMetres(refLon, refLat, lon0, lat0);
  const h = segHeadingDeg * DEG;
  const fx = Math.sin(h);
  const fy = Math.cos(h);
  const rx = -fy;
  const ry = fx;
  const vx = p.x - r.x;
  const vy = p.y - r.y;
  const along = vx * fx + vy * fy;
  const lateral = -(vx * rx + vy * ry);
  return { alongM: along, lateralM: lateral };
}

export function projectAlongCentreline(lon, lat, centreCoords) {
  let best = null;
  let cumS = 0;
  for (let i = 0; i < centreCoords.length - 1; i++) {
    const [aLon, aLat] = centreCoords[i];
    const [bLon, bLat] = centreCoords[i + 1];
    const { distanceM, alongM } = pointToSegmentMetres(lon, lat, aLon, aLat, bLon, bLat);
    const segLen = Math.hypot(
      localMetres(bLon, bLat, aLon, aLat).x,
      localMetres(bLon, bLat, aLon, aLat).y
    );
    const heading = bearingDeg(aLon, aLat, bLon, bLat);
    const latInfo = signedLateralM(lon, lat, heading, lon, lat);
    const candidate = {
      distanceM,
      chainS: cumS + alongM,
      lateralM: latInfo.lateralM,
      headingDeg: heading,
      segmentIndex: i,
    };
    if (!best || distanceM < best.distanceM) best = candidate;
    cumS += segLen;
  }
  return best;
}

export function pointInPolygon(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

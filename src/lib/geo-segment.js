import { haversineMetres } from './geo-square.js';

const DEG = Math.PI / 180;

export function bearingDeg(lon1, lat1, lon2, lat2) {
  const φ1 = lat1 * DEG;
  const φ2 = lat2 * DEG;
  const Δλ = (lon2 - lon1) * DEG;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x) * (180 / Math.PI);
  return (θ + 360) % 360;
}

export function headingDifferenceDeg(a, b) {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/** Local metres offset from (lon0,lat0). */
function toLocalM(lon, lat, lon0, lat0) {
  const latRad = lat0 * DEG;
  const mPerDegLat = 111132.954 - 559.822 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad);
  const mPerDegLon = mPerDegLat * Math.cos(latRad);
  return {
    x: (lon - lon0) * mPerDegLon,
    y: (lat - lat0) * mPerDegLat,
  };
}

/**
 * Perpendicular distance (metres) from point to segment AB; returns { distanceM, alongM, t }.
 */
export function pointToSegmentMetres(lon, lat, aLon, aLat, bLon, bLat) {
  const lon0 = (aLon + bLon + lon) / 3;
  const lat0 = (aLat + bLat + lat) / 3;
  const p = toLocalM(lon, lat, lon0, lat0);
  const a = toLocalM(aLon, aLat, lon0, lat0);
  const b = toLocalM(bLon, bLat, lon0, lat0);
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abLen2 = abx * abx + aby * aby;
  let t = 0;
  if (abLen2 > 0) {
    t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / abLen2;
    t = Math.max(0, Math.min(1, t));
  }
  const cx = a.x + t * abx;
  const cy = a.y + t * aby;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const distanceM = Math.sqrt(dx * dx + dy * dy);
  const alongM = Math.sqrt(abLen2) * t;
  return { distanceM, alongM, t };
}

export function movementBearingDeg(prevLon, prevLat, lon, lat) {
  if (prevLon == null || prevLat == null) return null;
  const d = haversineMetres(prevLon, prevLat, lon, lat);
  if (d < 0.3) return null;
  return bearingDeg(prevLon, prevLat, lon, lat);
}

export function median(values) {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function percentile(values, p) {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const idx = Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1));
  return v[idx];
}

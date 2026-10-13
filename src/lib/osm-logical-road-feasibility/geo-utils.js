import { haversineMetres } from '../geo-square.js';

const R = (Math.PI / 180) * 6371000;

export function coordKey(lon, lat, decimals = 7) {
  return `${lon.toFixed(decimals)},${lat.toFixed(decimals)}`;
}

export function bearingDeg(lon1, lat1, lon2, lat2) {
  const φ1 = lat1 * (Math.PI / 180);
  const φ2 = lat2 * (Math.PI / 180);
  const Δλ = (lon2 - lon1) * (Math.PI / 180);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

export function headingDeltaDeg(a, b) {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

export function endpointDistanceM(a, b) {
  return haversineMetres(a.lon, a.lat, b.lon, b.lat);
}

export function lineLengthM(coords) {
  let sum = 0;
  for (let i = 1; i < coords.length; i++) {
    sum += haversineMetres(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return sum;
}

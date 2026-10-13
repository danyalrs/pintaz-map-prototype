import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../config.js';

const PILOT_PATH = path.join(ROOT_DIR, 'config', 'pilot-area.json');

export function pilotAreaConfigPath() {
  return PILOT_PATH;
}

export function loadPilotAreaConfig() {
  if (!fs.existsSync(PILOT_PATH)) return null;
  return JSON.parse(fs.readFileSync(PILOT_PATH, 'utf8'));
}

/** @param {{ west: number, south: number, east: number, north: number }} b */
export function validateBounds(b) {
  if (!b || typeof b !== 'object') return { ok: false, error: 'missing_bounds' };
  const { west, south, east, north } = b;
  for (const v of [west, south, east, north]) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return { ok: false, error: 'non_numeric_bound' };
    }
  }
  if (west >= east) return { ok: false, error: 'west_not_less_than_east' };
  if (south >= north) return { ok: false, error: 'south_not_less_than_north' };
  return { ok: true };
}

export function isInsidePilotBounds(lon, lat, bounds) {
  return lon >= bounds.west && lon <= bounds.east && lat >= bounds.south && lat <= bounds.north;
}

export function paddedBounds(bounds, paddingDegrees) {
  const p = paddingDegrees || 0;
  return {
    west: bounds.west - p,
    south: bounds.south - p,
    east: bounds.east + p,
    north: bounds.north + p,
  };
}

export function boundsToFitCoordinates(bounds) {
  return [[bounds.west, bounds.south], [bounds.east, bounds.north]];
}

export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return { z, x, y };
}

export function pilotBoundsPolygon(bounds) {
  const { west, south, east, north } = bounds;
  return {
    type: 'Feature',
    properties: { role: 'pilot-outline' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    },
  };
}

import path from 'node:path';
import { ROOT_DIR } from '../config.js';

/**
 * Override with PINTAZ_MAPS_READ_ROOT for isolated tests only.
 */
export function mapsReadRootDir() {
  const override = process.env.PINTAZ_MAPS_READ_ROOT;
  if (override) return path.resolve(override);
  return path.join(ROOT_DIR, 'data', 'maps-read');
}

export function isIsolatedMapsReadRoot() {
  return Boolean(process.env.PINTAZ_MAPS_READ_ROOT);
}

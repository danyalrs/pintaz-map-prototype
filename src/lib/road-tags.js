import { OSM_LANE_SEMANTIC_TAG_KEYS } from './osm-lane-semantics.js';

/** OSM way tags copied into GeoJSON properties / vector-tile attributes. */
export const PRESERVED_TAG_KEYS = [
  'highway',
  'name',
  'ref',
  'maxspeed',
  'lanes',
  ...OSM_LANE_SEMANTIC_TAG_KEYS,
  'oneway',
  'bridge',
  'tunnel',
  'surface',
  'access',
  'service',
  'junction',
  'layer',
  'construction',
  'bicycle',
  'foot',
  'motor_vehicle',
];

export function pickTags(tags) {
  const out = {};
  if (!tags) return out;
  for (const key of PRESERVED_TAG_KEYS) {
    if (tags[key] != null && tags[key] !== '') {
      out[key] = String(tags[key]);
    }
  }
  return out;
}

export function isValidLonLat(lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return false;
  return true;
}

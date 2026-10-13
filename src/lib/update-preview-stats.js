const LAYER_NAMES = ['lane_point', 'edge_point', 'vehicle_pose', 'gps_point'];

export function countByLayer(features) {
  const counts = Object.fromEntries(LAYER_NAMES.map((k) => [k, 0]));
  for (const f of features) {
    const layer = f?.properties?.layer;
    if (layer && counts[layer] !== undefined) counts[layer] += 1;
  }
  return counts;
}

export function parseBboxString(bboxStr) {
  const parts = String(bboxStr).split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  const [minLon, minLat, maxLon, maxLat] = parts;
  return { minLon, minLat, maxLon, maxLat };
}

export function pointInsideBbox(lon, lat, bbox) {
  return lon >= bbox.minLon && lon <= bbox.maxLon && lat >= bbox.minLat && lat <= bbox.maxLat;
}

export function insideOutsideCounts(features, bbox) {
  let inside = 0;
  let outside = 0;
  for (const f of features) {
    const coords = f?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const [lon, lat] = coords;
    if (pointInsideBbox(lon, lat, bbox)) inside += 1;
    else outside += 1;
  }
  return { inside_area_count: inside, outside_area_count: outside };
}

export function geometryFingerprints(features) {
  return features.map((f) => JSON.stringify(f.geometry));
}

export { LAYER_NAMES };

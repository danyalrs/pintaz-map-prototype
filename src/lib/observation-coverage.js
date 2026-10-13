import fs from 'node:fs';
import { previewGeojsonPath, updateEnvelopePath } from './update-preview-paths.js';

export function bboxFromFeatures(features) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const f of features) {
    const c = f.geometry?.coordinates;
    if (!c || f.geometry.type !== 'Point') continue;
    const [lon, lat] = c;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    west = Math.min(west, lon);
    south = Math.min(south, lat);
    east = Math.max(east, lon);
    north = Math.max(north, lat);
  }
  if (!Number.isFinite(west)) return null;
  return { west, south, east, north };
}

export function loadObservationCoverageFeature(previewPathOverride = null) {
  const p = previewPathOverride || previewGeojsonPath();
  if (!fs.existsSync(p)) return null;
  const geo = JSON.parse(fs.readFileSync(p, 'utf8'));
  const b = bboxFromFeatures(geo.features || []);
  if (!b) return null;
  const pad = 0.00035;
  const west = b.west - pad;
  const east = b.east + pad;
  const south = b.south - pad;
  const north = b.north + pad;
  let scope = 'maps-read-page-1-truncated';
  const envPath = updateEnvelopePath();
  if (fs.existsSync(envPath)) {
    const env = JSON.parse(fs.readFileSync(envPath, 'utf8'));
    if (env.route_status === 'complete') scope = 'maps-read-complete-selected-route';
    else if (env.route_page_count > 1) scope = 'maps-read-partial-selected-route';
  }
  return {
    type: 'Feature',
    properties: {
      label: 'Server observation coverage — comparison available here',
      partial_page_scope: scope,
    },
    geometry: {
      type: 'Polygon',
      coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
    },
  };
}

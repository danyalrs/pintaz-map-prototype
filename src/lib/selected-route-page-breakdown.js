import fs from 'node:fs';
import path from 'node:path';
import { normalizeBareNanInJson } from './json-nan-normalize.js';
import { countByLayer, insideOutsideCounts, parseBboxString } from './update-preview-stats.js';
import { PAGE_000_PATH, SELECTED_ROUTE_RAW_DIR } from './selected-route-paths.js';
import { ROUTE_SELECTION_PRIVATE_PATH } from './update-preview-paths.js';

export function pilotBboxFromRouteSelection() {
  if (!fs.existsSync(ROUTE_SELECTION_PRIVATE_PATH)) {
    return parseBboxString('101.708993,3.141007,101.727007,3.158993');
  }
  const sel = JSON.parse(fs.readFileSync(ROUTE_SELECTION_PRIVATE_PATH, 'utf8'));
  return parseBboxString(sel.bbox);
}

export function insideOutsideByLayerForPageFile(filePath, bbox) {
  const text = fs.readFileSync(filePath, 'utf8');
  const { normalized } = normalizeBareNanInJson(text);
  const collection = JSON.parse(normalized);
  const features = collection.features || [];
  const inside = { lane_point: 0, edge_point: 0, vehicle_pose: 0, gps_point: 0 };
  const outside = { lane_point: 0, edge_point: 0, vehicle_pose: 0, gps_point: 0 };
  for (const f of features) {
    const layer = f.properties?.layer;
    if (!Object.hasOwn(inside, layer)) continue;
    const [lon, lat] = f.geometry?.coordinates || [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const inBox = lon >= bbox.minLon && lon <= bbox.maxLon && lat >= bbox.minLat && lat <= bbox.maxLat;
    if (inBox) inside[layer] = (inside[layer] || 0) + 1;
    else outside[layer] = (outside[layer] || 0) + 1;
  }
  const totals = insideOutsideCounts(features, bbox);
  return {
    file: path.basename(filePath),
    feature_count: features.length,
    layer_counts: countByLayer(features),
    inside_by_layer: inside,
    outside_by_layer: outside,
    inside_total: totals.inside_area_count,
    outside_total: totals.outside_area_count,
  };
}

export function completeRoutePageBreakdown() {
  const bbox = pilotBboxFromRouteSelection();
  if (!bbox || !fs.existsSync(SELECTED_ROUTE_RAW_DIR)) return null;
  const pages = fs
    .readdirSync(SELECTED_ROUTE_RAW_DIR)
    .filter((f) => /^page-\d{3}.*\.geojson$/.test(f))
    .sort();
  const perPage = pages.map((f) => insideOutsideByLayerForPageFile(path.join(SELECTED_ROUTE_RAW_DIR, f), bbox));
  const page0 = perPage[0];
  const page1 = perPage[1];
  return {
    pilot_bbox: bbox,
    pages: perPage,
    page1_file: page0,
    page2_file: page1,
    page2_added_features: page1?.feature_count ?? 0,
    page2_added_inside_pilot: page1?.inside_total ?? 0,
    page2_added_outside_pilot: page1?.outside_total ?? 0,
  };
}

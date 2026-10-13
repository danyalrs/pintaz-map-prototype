import fs from 'node:fs';
import path from 'node:path';
import { previewGeojsonPath, updateEnvelopePath, ROUTE_SELECTION_PRIVATE_PATH } from '../update-preview-paths.js';
import { localAreaGeojsonPath } from '../local-areas.js';
import { bboxFromFeatures } from '../observation-coverage.js';

const PILOT_AREA_KM2 = 4;

function countLayers(features) {
  const by = {};
  for (const f of features) {
    const layer = f.properties?.layer || f.properties?.rendered_layer || 'unknown';
    by[layer] = (by[layer] || 0) + 1;
  }
  return by;
}

function bboxAreaKm2(bbox) {
  if (!bbox) return null;
  const latMid = (bbox.south + bbox.north) / 2;
  const mPerDegLat = 111320;
  const mPerDegLon = mPerDegLat * Math.cos((latMid * Math.PI) / 180);
  const w = (bbox.east - bbox.west) * mPerDegLon;
  const h = (bbox.north - bbox.south) * mPerDegLat;
  return (w * h) / 1_000_000;
}

export function auditServerObservationScope() {
  const previewPath = previewGeojsonPath();
  const envelopePath = updateEnvelopePath();
  const out = {
    endpoint_active_metrics: '/api/local-route-explorer/v1/routes/active/metrics',
    endpoint_observations_geojson:
      '/api/local-route-explorer/v1/routes/active/observations.geojson',
    preview_file_present: fs.existsSync(previewPath),
    envelope_present: fs.existsSync(envelopePath),
    feature_total: 0,
    inside_area_count: null,
    outside_area_count: null,
    route_status: null,
    partial_response: null,
    counts_by_layer: {},
    observation_bbox: null,
    pilot_area_km2: PILOT_AREA_KM2,
    traverses_pilot_pct_estimate: null,
    selected_routes_in_manifest: null,
    diagnostic_routes_note: null,
  };

  if (fs.existsSync(envelopePath)) {
    const env = JSON.parse(fs.readFileSync(envelopePath, 'utf8'));
    out.route_status = env.route_status ?? null;
    out.partial_response = env.partial_response ?? null;
    out.feature_total = env.feature_total ?? 0;
    out.inside_area_count = env.inside_area_count ?? null;
    out.outside_area_count = env.outside_area_count ?? null;
    out.update_id = env.update_id ? String(env.update_id).slice(0, 32) : null;
  }

  if (fs.existsSync(previewPath)) {
    const geo = JSON.parse(fs.readFileSync(previewPath, 'utf8'));
    const feats = geo.features || [];
    out.feature_total = feats.length;
    out.counts_by_layer = countLayers(feats);
    out.observation_bbox = bboxFromFeatures(feats);
    const obsArea = bboxAreaKm2(out.observation_bbox);
    if (obsArea != null && PILOT_AREA_KM2 > 0) {
      out.traverses_pilot_pct_estimate = Math.min(100, Math.round((obsArea / PILOT_AREA_KM2) * 1000) / 10);
    }
  }

  if (fs.existsSync(ROUTE_SELECTION_PRIVATE_PATH)) {
    try {
      const sel = JSON.parse(fs.readFileSync(ROUTE_SELECTION_PRIVATE_PATH, 'utf8'));
      const routes = sel.routes || sel.selected_routes || [];
      out.selected_routes_in_manifest = Array.isArray(routes) ? routes.length : null;
      out.diagnostic_routes_note =
        'Additional downloaded routes may exist under maps-read samples; only the active bundle preview is wired to the production UI.';
    } catch {
      out.diagnostic_routes_note = 'route_selection.private.json unreadable';
    }
  } else {
    out.diagnostic_routes_note =
      'Production UI loads the active observation route only; other maps-read samples are diagnostic and not mounted as observations.';
  }

  out.clarifications = [
    'complete route means the selected Maps Read response is complete, not full 2 km pilot coverage',
    'absence of points outside the observation corridor does not prove absence of server inventory',
  ];

  return out;
}

export function redactServerScope(scope) {
  const copy = { ...scope };
  delete copy.update_id;
  return copy;
}

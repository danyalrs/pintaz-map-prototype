import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../../config.js';
import { ROUTE_SELECTION_PRIVATE_PATH } from '../update-preview-paths.js';
import { DERIVED_PREVIEW_PATH } from '../selected-route-paths.js';
import { derivedPreviewPath } from '../local-route-explorer/paths.js';
import { routeSortKey } from '../bukit-route-redaction.js';
import { DATA_DIR } from './constants.js';

const POSE_RAW_DIR = path.join(DATA_DIR, 'vehicle-pose-raw');
const DRIVE_REF_MAP_PATH = path.join(
  ROOT_DIR,
  'data',
  'maps-read',
  'bukit-route-page1-probe-v1',
  'private',
  'drive-ref-map.private.json'
);

const PROBE_PREVIEW_KEYS = new Set(['drive-001', 'drive-005', 'drive-007', 'drive-008', 'drive-010']);

let _localByRouteKey = null;

export function buildLocalVehiclePoseSourceMap() {
  if (_localByRouteKey) return _localByRouteKey;
  const map = new Map();
  if (fs.existsSync(DRIVE_REF_MAP_PATH)) {
    const { mappings } = JSON.parse(fs.readFileSync(DRIVE_REF_MAP_PATH, 'utf8'));
    for (const m of mappings || []) {
      if (!PROBE_PREVIEW_KEYS.has(m.probe_ref)) continue;
      const preview = derivedPreviewPath(m.probe_ref);
      if (!fs.existsSync(preview)) continue;
      map.set(routeSortKey(m), {
        geojsonPath: preview,
        source: `local-route-explorer-derived-preview:${m.probe_ref}`,
        inventory_drive_ref: m.inventory_drive_ref,
      });
    }
  }
  if (fs.existsSync(ROUTE_SELECTION_PRIVATE_PATH) && fs.existsSync(DERIVED_PREVIEW_PATH)) {
    const sel = JSON.parse(fs.readFileSync(ROUTE_SELECTION_PRIVATE_PATH, 'utf8'));
    if (sel?.dongle && sel?.route) {
      map.set(routeSortKey(sel), {
        geojsonPath: DERIVED_PREVIEW_PATH,
        source: 'selected-route-v1-derived-preview:active',
        inventory_drive_ref: null,
      });
    }
  }
  _localByRouteKey = map;
  return map;
}

export function importLocalVehiclePosesIfAvailable({ routeRef, dongle, route }) {
  const sources = buildLocalVehiclePoseSourceMap();
  const src = sources.get(routeSortKey({ dongle, route }));
  if (!src) return null;

  const rawDir = path.join(POSE_RAW_DIR, routeRef);
  const out = path.join(rawDir, 'page-000-first.geojson');
  if (fs.existsSync(out)) {
    return { imported: true, reused: true, source: src.source };
  }

  const geo = JSON.parse(fs.readFileSync(src.geojsonPath, 'utf8'));
  const poses = (geo.features || []).filter((f) => f.properties?.layer === 'vehicle_pose');
  if (!poses.length) return null;

  fs.mkdirSync(rawDir, { recursive: true });
  fs.writeFileSync(
    out,
    `${JSON.stringify({ type: 'FeatureCollection', features: poses }, null, 2)}\n`,
    'utf8'
  );
  return {
    imported: true,
    reused: false,
    source: src.source,
    vehicle_pose_count: poses.length,
  };
}

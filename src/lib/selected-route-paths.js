import path from 'node:path';
import { mapsReadRootDir } from './maps-read-root.js';
import { RAW_SAMPLE_PATH, ROUTE_SELECTION_PRIVATE_PATH } from './update-preview-paths.js';

const MAPS_READ_BASE = mapsReadRootDir();

export const MAPS_READ_API_BASE = 'https://maps-read.kommu.ai';

export const SELECTED_ROUTE_V1_DIR = path.join(MAPS_READ_BASE, 'selected-route-v1');
export const SELECTED_ROUTE_RAW_DIR = path.join(SELECTED_ROUTE_V1_DIR, 'raw');
export const SELECTED_ROUTE_DERIVED_DIR = path.join(SELECTED_ROUTE_V1_DIR, 'derived');

export const PAGE_000_FILENAME = 'page-000-existing.geojson';
export const PAGE_000_PATH = path.join(SELECTED_ROUTE_RAW_DIR, PAGE_000_FILENAME);
export const EXISTING_RAW_SOURCE_PATH = RAW_SAMPLE_PATH;

export const DERIVED_PREVIEW_PATH = path.join(SELECTED_ROUTE_DERIVED_DIR, 'complete-route-preview.geojson');
export const DERIVED_ENVELOPE_PATH = path.join(SELECTED_ROUTE_DERIVED_DIR, 'complete-route-envelope.json');
export const DERIVED_VALIDATION_PATH = path.join(SELECTED_ROUTE_DERIVED_DIR, 'complete-route-validation.json');
export const PAGE_MANIFEST_PRIVATE_PATH = path.join(SELECTED_ROUTE_DERIVED_DIR, 'page-manifest.private.json');
export const PAGINATION_RUN_PRIVATE_PATH = path.join(SELECTED_ROUTE_V1_DIR, 'pagination-run.private.json');

export const PAGE1_METRICS_SNAPSHOT_PATH = path.join(
  SELECTED_ROUTE_V1_DIR,
  'analysis-page1-snapshot.private.json'
);

export { ROUTE_SELECTION_PRIVATE_PATH };

export function rawPagePath(pageNumber, afterSeg = null) {
  const n = String(pageNumber).padStart(3, '0');
  if (pageNumber === 0) return PAGE_000_PATH;
  const seg = afterSeg == null ? 'unknown' : String(afterSeg);
  return path.join(SELECTED_ROUTE_RAW_DIR, `page-${n}-after-${seg}.geojson`);
}

export function listRawPageFiles() {
  return [];
}

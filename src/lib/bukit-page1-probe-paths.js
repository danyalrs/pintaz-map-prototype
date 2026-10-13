import path from 'node:path';
import { mapsReadRootDir } from './maps-read-root.js';
import { SHORTLIST_PRIVATE_PATH } from './bukit-route-shortlist-paths.js';
import { MAPS_READ_API_BASE } from './selected-route-paths.js';

export const PROBE_BASE = path.join(mapsReadRootDir(), 'bukit-route-page1-probe-v1');
export const PROBE_RAW_DIR = path.join(PROBE_BASE, 'private', 'raw');
export const PROBE_PRIVATE_DIR = path.join(PROBE_BASE, 'private');

export const PROBE_MANIFEST_PRIVATE_PATH = path.join(PROBE_PRIVATE_DIR, 'probe-manifest.private.json');
export const ROUTE_RESULTS_PRIVATE_PATH = path.join(PROBE_PRIVATE_DIR, 'route-results.private.json');
export const RECOMMENDED_ROUTES_PRIVATE_PATH = path.join(PROBE_PRIVATE_DIR, 'recommended-routes.private.json');
export const DRIVE_REF_MAP_PRIVATE_PATH = path.join(PROBE_PRIVATE_DIR, 'drive-ref-map.private.json');

export const PROBE_SUMMARY_REDACTED_PATH = path.join(PROBE_BASE, 'probe-summary.redacted.json');
export const ROUTE_RANKINGS_REDACTED_PATH = path.join(PROBE_BASE, 'route-rankings.redacted.json');
export const RECOMMENDATION_REDACTED_PATH = path.join(PROBE_BASE, 'recommendation.redacted.json');
export const LATER_PAGE_SCAN_REDACTED_PATH = path.join(PROBE_BASE, 'later-page-scan-needed.redacted.json');

export const GEOJSON_LAYERS = 'vehicle_pose,lane_point,edge_point,gps_point';
export const MAX_SHORTLIST_ROUTES = 10;

export { SHORTLIST_PRIVATE_PATH, MAPS_READ_API_BASE };

export function probeRawFileName(probeRef) {
  return `${probeRef}-page-1.geojson`;
}

export function probeRawPath(probeRef) {
  return path.join(PROBE_RAW_DIR, probeRawFileName(probeRef));
}

export function formatProbeRef(indexOneBased) {
  return `drive-${String(indexOneBased).padStart(3, '0')}`;
}

import path from 'node:path';
import { mapsReadRootDir } from './maps-read-root.js';
import { MAPS_READ_API_BASE } from './selected-route-paths.js';

export const BUKIT_PILOT_AREA_ID = 'bukit-bintang-imbi';
export const BUKIT_PILOT_BBOX = '101.708993,3.141007,101.727007,3.158993';
export const BUKIT_PILOT_BBOX_PARTS = {
  minLon: 101.708993,
  minLat: 3.141007,
  maxLon: 101.727007,
  maxLat: 3.158993,
};

export const PRIOR_COVERAGE_ROUTE_COUNT = 1706;

export const SHORTLIST_BASE = path.join(mapsReadRootDir(), 'bukit-route-shortlist-v1');
export const SHORTLIST_RAW_DIR = path.join(SHORTLIST_BASE, 'private', 'raw');
export const SHORTLIST_PRIVATE_DIR = path.join(SHORTLIST_BASE, 'private');
export const INVENTORY_PRIVATE_PATH = path.join(SHORTLIST_PRIVATE_DIR, 'inventory.private.json');
export const PAGINATION_RUN_PRIVATE_PATH = path.join(SHORTLIST_PRIVATE_DIR, 'pagination-run.private.json');
export const SHORTLIST_PRIVATE_PATH = path.join(SHORTLIST_PRIVATE_DIR, 'shortlist.private.json');
export const SHORTLIST_REDACTED_PATH = path.join(SHORTLIST_BASE, 'shortlist.redacted.json');
export const RANKINGS_REDACTED_PATH = path.join(SHORTLIST_BASE, 'rankings.redacted.json');

export { MAPS_READ_API_BASE };

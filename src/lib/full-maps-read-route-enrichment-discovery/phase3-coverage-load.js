import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, TARGET_WAYS } from './constants.js';
import { loadUnknownLaneOsmWays } from './missing-lane-ways.js';
import { loadCachedCatalogRecordByRef } from './routes-catalog.js';
import { loadVehiclePosesFromRaw } from './fetch-vehicle-poses.js';

const PROGRESS_PATH = path.join(DATA_DIR, 'discovery-progress.json');

export function loadDiscoveryCoverageWayRows() {
  if (!fs.existsSync(PROGRESS_PATH)) return [];
  const progress = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
  return progress.way_rows || [];
}

export function loadCoverageIndexSummary() {
  const wayRows = loadDiscoveryCoverageWayRows();
  const routeRefs = new Set(wayRows.map((r) => r.route_ref));
  const wayIds = new Set(wayRows.map((r) => r.osm_way_id));
  const unknownWays = loadUnknownLaneOsmWays();
  const unknownWithCoverage = unknownWays.filter((w) => wayIds.has(w.osm_way_id));
  return {
    way_row_count: wayRows.length,
    route_ref_count: routeRefs.size,
    unknown_lane_way_count: unknownWays.length,
    unknown_lane_ways_with_coverage: unknownWithCoverage.length,
    way_rows: wayRows,
    route_refs: [...routeRefs].sort(),
    unknown_way_ids_with_coverage: wayIds,
  };
}

export function loadPosesForRouteRef(routeRef, parseStats = null) {
  return loadVehiclePosesFromRaw(routeRef, parseStats);
}

export function targetWayIds() {
  return {
    jalan_kamuning: TARGET_WAYS.JALAN_KAMUNING,
    lorong_kuda: TARGET_WAYS.LORONG_KUDA,
  };
}

export { loadCachedCatalogRecordByRef, loadUnknownLaneOsmWays };

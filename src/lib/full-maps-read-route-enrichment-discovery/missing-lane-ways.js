import fs from 'node:fs';
import { roadIndexPath } from '../lane-baseline-paths.js';
import { DEFAULT_LOCAL_AREA_ID } from '../local-areas.js';
import { normalizeOsmWayId } from '../selected-route-osm-comparison-lookup.js';

export function isMissingUsableLaneCount(entry) {
  if (!entry) return true;
  if (entry.lane_count_source === 'lane_count_unknown') return true;
  if (entry.lanes_raw?.kind === 'valid_numeric') return false;
  return !(Number(entry.lane_count_total) > 0);
}

export function loadUnknownLaneOsmWays(areaId = DEFAULT_LOCAL_AREA_ID) {
  const idx = JSON.parse(fs.readFileSync(roadIndexPath(areaId), 'utf8'));
  const ways = [];
  for (const [id, entry] of Object.entries(idx.by_osm_id || {})) {
    if (!isMissingUsableLaneCount(entry)) continue;
    ways.push({
      osm_way_id: normalizeOsmWayId(id),
      highway: entry.highway ?? null,
      name: entry.name ?? null,
      lane_count_source: entry.lane_count_source ?? 'lane_count_unknown',
    });
  }
  ways.sort((a, b) => a.osm_way_id.localeCompare(b.osm_way_id));
  return ways;
}

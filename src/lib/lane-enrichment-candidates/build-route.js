import fs from 'node:fs';
import { derivedPreviewPath } from '../local-route-explorer/paths.js';
import { previewGeojsonPath } from '../update-preview-paths.js';
import { routeComparisonDir } from '../local-route-explorer/paths.js';
import { matchedPosesPath } from '../comparison-paths.js';
import { roadIndexPath } from '../lane-baseline-paths.js';
import { DEFAULT_LOCAL_AREA_ID } from '../local-areas.js';
import { localAreaGeojsonPath } from '../local-areas.js';
import { normalizeOsmWayId } from '../selected-route-osm-comparison-lookup.js';
import { buildWayRow } from './build-way-row.js';
import { DECISION } from './constants.js';

function loadJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function roadNameMap() {
  const roads = loadJson(localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID));
  const m = new Map();
  for (const f of roads?.features || []) {
    const id = normalizeOsmWayId(f.properties?.osm_id);
    if (id) m.set(id, f.properties?.name || null);
  }
  return m;
}

function isMissingOsmLanes(entry) {
  if (!entry) return false;
  if (entry.lane_count_source === 'lane_count_unknown') return true;
  if (entry.lanes_raw?.kind === 'valid_numeric') return false;
  return !(Number(entry.lane_count_total) > 0);
}

/**
 * Build rows for all OSM ways missing lane count that appear on this route's matcher output.
 */
export function buildRouteEnrichmentRows(routeKey, { includeOsmBaselineWays = [] } = {}) {
  const previewPath = routeKey === 'active' ? previewGeojsonPath() : derivedPreviewPath(routeKey);
  if (!fs.existsSync(previewPath)) {
    return { ok: false, error: 'preview_missing', route_key: routeKey, rows: [] };
  }

  const compDir = routeComparisonDir(routeKey);
  const matched = loadJson(matchedPosesPath(compDir));
  if (!matched?.features?.length) {
    return { ok: false, error: 'matched_poses_missing', route_key: routeKey, rows: [] };
  }

  const preview = loadJson(previewPath);
  const previewFeatures = preview?.features || [];

  const roadIndex = loadJson(roadIndexPath(DEFAULT_LOCAL_AREA_ID));
  const names = roadNameMap();
  const osmIdsOnRoute = new Set(
    matched.features.map((f) => normalizeOsmWayId(f.properties?.osm_id)).filter(Boolean)
  );
  for (const id of includeOsmBaselineWays) osmIdsOnRoute.add(normalizeOsmWayId(id));

  const targetIds = new Set();
  for (const id of osmIdsOnRoute) {
    const entry = roadIndex?.by_osm_id?.[id];
    if (isMissingOsmLanes(entry) || includeOsmBaselineWays.includes(id)) {
      targetIds.add(id);
    }
  }

  const rows = [];
  for (const osmId of [...targetIds].sort()) {
    rows.push(
      buildWayRow({
        fs,
        routeKey,
        osmWayId: osmId,
        matchedPoses: matched.features,
        previewFeatures,
        roadIndexEntry: roadIndex?.by_osm_id?.[osmId],
        roadName: names.get(osmId) || null,
      })
    );
  }

  return { ok: true, route_key: routeKey, rows };
}

export function summarizeRejections(rows) {
  const counts = {};
  for (const row of rows) {
    for (const r of row.rejected_frame_reasons || []) {
      for (const reason of r.reasons || []) {
        counts[reason] = (counts[reason] || 0) + 1;
      }
    }
  }
  const decisions = {};
  for (const row of rows) {
    decisions[row.decision] = (decisions[row.decision] || 0) + 1;
  }
  return { rejection_reason_counts: counts, decision_counts: decisions, row_count: rows.length };
}

export function buildAllRoutes(routeKeys, options = {}) {
  const allRows = [];
  for (const key of routeKeys) {
    const res = buildRouteEnrichmentRows(key, options);
    if (res.ok) allRows.push(...res.rows);
  }
  return allRows;
}

export { DECISION };

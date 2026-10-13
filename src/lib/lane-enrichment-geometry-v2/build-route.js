import fs from 'node:fs';
import { derivedPreviewPath } from '../local-route-explorer/paths.js';
import { previewGeojsonPath } from '../update-preview-paths.js';
import { routeComparisonDir } from '../local-route-explorer/paths.js';
import { matchedPosesPath } from '../comparison-paths.js';
import { roadIndexPath } from '../lane-baseline-paths.js';
import { localAreaGeojsonPath, DEFAULT_LOCAL_AREA_ID } from '../local-areas.js';
import { normalizeOsmWayId } from '../selected-route-osm-comparison-lookup.js';
import { buildGeometryWayRow } from './build-way.js';
import { isOneWayWay } from './cross-section.js';
import { OUTCOME } from './constants.js';

function loadJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function roadFeatureMap() {
  const roads = loadJson(localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID));
  const m = new Map();
  for (const f of roads?.features || []) {
    const id = normalizeOsmWayId(f.properties?.osm_id);
    if (id) m.set(id, f);
  }
  return m;
}

export function buildRouteGeometry(routeKey, { evalWayIds = [] } = {}) {
  const previewPath = routeKey === 'active' ? previewGeojsonPath() : derivedPreviewPath(routeKey);
  if (!fs.existsSync(previewPath)) {
    return { ok: false, route_key: routeKey, rows: [] };
  }
  const compDir = routeComparisonDir(routeKey);
  const matched = loadJson(matchedPosesPath(compDir));
  if (!matched?.features?.length) {
    return { ok: false, route_key: routeKey, rows: [] };
  }
  const preview = loadJson(previewPath);
  const roadIndex = loadJson(roadIndexPath(DEFAULT_LOCAL_AREA_ID));
  const features = roadFeatureMap();
  const osmOnRoute = new Set(
    matched.features.map((f) => normalizeOsmWayId(f.properties?.osm_id)).filter(Boolean)
  );
  for (const id of evalWayIds) osmOnRoute.add(normalizeOsmWayId(id));

  const targetIds = [];
  for (const id of osmOnRoute) {
    const entry = roadIndex?.by_osm_id?.[id];
    const feat = features.get(id);
    if (!feat || !isOneWayWay(feat, entry)) continue;
    targetIds.push(id);
  }

  const rows = targetIds.sort().map((id) =>
    buildGeometryWayRow({
      routeKey,
      osmWayId: id,
      roadFeature: features.get(id),
      roadIndexEntry: roadIndex?.by_osm_id?.[id],
      matchedPoses: matched.features,
      previewFeatures: preview?.features || [],
      evalLabelOsmLanes: evalWayIds.includes(id) ? roadIndex?.by_osm_id?.[id]?.lane_count_total : null,
    })
  );
  return { ok: true, route_key: routeKey, rows };
}

export function buildEvaluationSummary(allRows) {
  const evalRows = allRows.filter((r) => r.osm_lane_count_baseline != null);
  let exact = 0;
  let disagree = 0;
  let insufficient = 0;
  for (const r of evalRows) {
    if (r.decision === OUTCOME.GEOMETRY_AGREES_WITH_OSM_BASELINE) exact += 1;
    else if (r.decision === OUTCOME.GEOMETRY_DISAGREES_WITH_OSM_REVIEW) disagree += 1;
    else insufficient += 1;
  }
  const candidates = allRows.filter(
    (r) => r.decision === OUTCOME.GEOMETRY_CANDIDATE_MISSING_OSM_LANES
  ).length;
  const insufAll = allRows.filter((r) => r.decision === OUTCOME.INSUFFICIENT_EVIDENCE).length;
  return {
    evaluation_way_count: evalRows.length,
    exact_match_count: exact,
    disagree_review_count: disagree,
    insufficient_evidence_eval_count: insufficient,
    geometry_candidate_missing_lanes_count: candidates,
    insufficient_evidence_total: insufAll,
    coverage_rows: allRows.length,
  };
}

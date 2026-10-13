import fs from 'node:fs';
import { countByLayer, insideOutsideCounts } from '../update-preview-stats.js';
import { loadBukitPilotBbox, pointInsideBukitPilot } from '../bukit-pilot-bounds.js';
import { coordinateBounds } from '../selected-route-page-validate.js';
import { comparisonSummaryPath } from '../comparison-paths.js';
import { mapsReadRootDir } from '../maps-read-root.js';
import path from 'node:path';
import { OBSERVATION_ROUTES, observationRouteSpec } from './config.js';
import { ensureDerivedPreviewGeojson } from './bootstrap.js';
import { routeComparisonDir } from './paths.js';

function insideBounds(features, bbox) {
  const inside = features.filter((f) => {
    const [lon, lat] = f.geometry?.coordinates ?? [];
    return Number.isFinite(lon) && Number.isFinite(lat) && pointInsideBukitPilot(lon, lat, bbox);
  });
  return coordinateBounds(inside.length ? inside : features);
}

function osmWayCountFromAudit(routeKey) {
  const auditPath = path.join(
    mapsReadRootDir(),
    'bukit-overlap-oriented-route-selection-v1',
    'matching_audit.redacted.json'
  );
  if (!fs.existsSync(auditPath)) return null;
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  const row = audit.routes?.find((r) => r.route_key === routeKey);
  return row?.distinct_matched_osm_ways ?? null;
}

export function buildRouteMetricsRedacted(routeKey) {
  const spec = observationRouteSpec(routeKey);
  if (!spec) return null;
  const preview = ensureDerivedPreviewGeojson(routeKey);
  if (!preview.ok || !fs.existsSync(preview.previewPath)) {
    return {
      route_key: routeKey,
      option_label: spec.option_label,
      complete: false,
      inventory_tags: spec.inventory_tags,
      diagnostic_only: routeKey !== 'active',
    };
  }
  const geo = JSON.parse(fs.readFileSync(preview.previewPath, 'utf8'));
  const features = geo.features || [];
  const bbox = loadBukitPilotBbox();
  const layers = countByLayer(features);
  const { inside_area_count, outside_area_count } = insideOutsideCounts(features, bbox);
  const compDir = routeComparisonDir(routeKey);
  let summary = null;
  const sp = comparisonSummaryPath(compDir);
  if (fs.existsSync(sp)) summary = JSON.parse(fs.readFileSync(sp, 'utf8'));

  return {
    route_key: routeKey,
    option_label: spec.option_label,
    role: spec.role,
    diagnostic_only: routeKey !== 'active',
    complete: routeKey === 'active' ? true : true,
    route_status: 'complete',
    feature_total: features.length,
    inside_pilot_total: inside_area_count,
    outside_pilot_total: outside_area_count,
    counts_by_layer: {
      vehicle_pose: layers.vehicle_pose || 0,
      lane_point: layers.lane_point || 0,
      edge_point: layers.edge_point || 0,
      gps_point: layers.gps_point || 0,
    },
    corridor_bounds: insideBounds(features, bbox),
    osm_ways_touched: osmWayCountFromAudit(routeKey),
    inventory_tags: spec.inventory_tags,
    comparison_matched_poses: summary?.matched_pose_count ?? null,
    comparison_section_count: summary?.section_count ?? null,
  };
}

export function buildAllRouteMetricsRedacted() {
  return OBSERVATION_ROUTES.map((r) => buildRouteMetricsRedacted(r.route_key)).filter(Boolean);
}

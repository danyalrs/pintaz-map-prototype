import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './constants.js';
import { loadPhase3Checkpoint } from './phase3-checkpoint.js';
import { ROUTE_VERDICT } from '../route-aware-lane-calibration-audit/constants.js';
import { summarizeGeojsonFile } from '../maps-read-lane-geometry-capability-audit/geojson-schema-summary.js';
import { isCurrentMapsReadPointOnlyExport } from '../maps-read-polyline-adapter/detect-point-only.js';
import { parseMapsReadGeoJsonFromUtf8 } from './parse-maps-read-geojson.js';

export const LANE_EDGE_EXPORT_CLASS = {
  POINT_ONLY: 'point_only',
  POLYLINE_CONTAINING: 'polyline_containing',
  MIXED: 'mixed',
  MISSING: 'missing',
  UNREADABLE: 'unreadable',
  UNKNOWN: 'unknown',
};

const QUAL_RAW = path.join(DATA_DIR, 'qualification-raw');

export function laneEdgeExportPath(routeRef) {
  return path.join(QUAL_RAW, routeRef, 'lane-edge.geojson');
}

export function classifyLaneEdgeExportFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { classification: LANE_EDGE_EXPORT_CLASS.MISSING, detail: 'file_not_found' };
  }
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return { classification: LANE_EDGE_EXPORT_CLASS.UNREADABLE, detail: `read_failed:${e.message}` };
  }
  const parsed = parseMapsReadGeoJsonFromUtf8(text);
  if (!parsed.ok) {
    return {
      classification: LANE_EDGE_EXPORT_CLASS.UNREADABLE,
      detail: parsed.parseReason || 'parse_failed',
    };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { classification: LANE_EDGE_EXPORT_CLASS.UNREADABLE, detail: `json:${e.message}` };
  }

  const summary = summarizeGeojsonFile(filePath, { maxFeaturesScan: 12000 });
  const hasPolyline =
    summary.has_linestring_lane_edge === true ||
    summary.has_ordered_coordinate_arrays_in_properties === true;
  const hasLaneEdgePoints =
    (summary.geometry_by_layer?.lane_point?.Point ?? 0) > 0 ||
    (summary.geometry_by_layer?.edge_point?.Point ?? 0) > 0;
  const pointOnlySchema = isCurrentMapsReadPointOnlyExport(raw);
  const maxLaneVerts = summary.max_vertices_per_lane_index_per_frame ?? 0;
  const maxEdgeVerts = summary.max_vertices_per_edge_index_per_frame ?? 0;
  const pointOnlyHeuristic =
    pointOnlySchema ||
    (hasLaneEdgePoints && !hasPolyline && maxLaneVerts <= 1 && maxEdgeVerts <= 1);

  if (hasPolyline && (pointOnlySchema || hasLaneEdgePoints)) {
    return {
      classification: LANE_EDGE_EXPORT_CLASS.MIXED,
      detail: 'polyline_and_point_layers',
      feature_count: summary.feature_count,
      max_vertices_per_lane_index_per_frame: maxLaneVerts,
    };
  }
  if (hasPolyline) {
    return {
      classification: LANE_EDGE_EXPORT_CLASS.POLYLINE_CONTAINING,
      detail: 'linestring_or_coordinates_local_m',
      feature_count: summary.feature_count,
    };
  }
  if (pointOnlyHeuristic) {
    return {
      classification: LANE_EDGE_EXPORT_CLASS.POINT_ONLY,
      detail: pointOnlySchema ? 'visualization_point_cloud' : 'single_point_per_lane_index',
      feature_count: summary.feature_count,
      max_vertices_per_lane_index_per_frame: maxLaneVerts,
      max_vertices_per_edge_index_per_frame: maxEdgeVerts,
    };
  }
  if ((summary.feature_count ?? 0) === 0) {
    return { classification: LANE_EDGE_EXPORT_CLASS.UNKNOWN, detail: 'empty_feature_collection' };
  }
  return {
    classification: LANE_EDGE_EXPORT_CLASS.UNKNOWN,
    detail: 'unclassified_schema',
    feature_count: summary.feature_count,
    geometry_by_layer: summary.geometry_by_layer,
  };
}

export function listQualifiedRouteRefs(checkpoint = loadPhase3Checkpoint()) {
  return Object.values(checkpoint.routes || {})
    .filter((r) => r.route_verdict === ROUTE_VERDICT.QUALIFIED)
    .map((r) => r.route_ref)
    .sort();
}

export function auditQualifiedRouteLaneEdgeExports({ checkpointPath } = {}) {
  const checkpoint = loadPhase3Checkpoint(checkpointPath);
  const routeRefs = listQualifiedRouteRefs(checkpoint);
  const counts = {
    point_only: 0,
    polyline_containing: 0,
    mixed: 0,
    missing: 0,
    unreadable: 0,
    unknown: 0,
  };
  const perRoute = [];

  for (const routeRef of routeRefs) {
    const filePath = laneEdgeExportPath(routeRef);
    const result = classifyLaneEdgeExportFile(filePath);
    counts[result.classification] = (counts[result.classification] || 0) + 1;
    perRoute.push({ route_ref: routeRef, file: path.relative(DATA_DIR, filePath).replace(/\\/g, '/'), ...result });
  }

  return {
    schema: 'qualified-route-lane-edge-export-audit-v1',
    generated_at: new Date().toISOString(),
    qualification_raw_dir: QUAL_RAW,
    qualified_route_count: routeRefs.length,
    counts,
    per_route: perRoute,
    lane_count_inferred: false,
  };
}

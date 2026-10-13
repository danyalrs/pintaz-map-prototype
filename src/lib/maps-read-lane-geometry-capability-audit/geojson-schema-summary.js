import fs from 'node:fs';
import { normalizeBareNanInJson } from '../json-nan-normalize.js';

/**
 * Summarize a FeatureCollection from documented /v1/geojson without retaining coordinates.
 */
export function summarizeGeojsonFile(filePath, { maxFeaturesScan = 8000 } = {}) {
  if (!fs.existsSync(filePath)) {
    return { exists: false, path: filePath };
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  let collection;
  try {
    collection = JSON.parse(raw);
  } catch {
    const { normalized } = normalizeBareNanInJson(raw);
    collection = JSON.parse(normalized);
  }
  const features = collection.features || [];
  const scan = features.slice(0, maxFeaturesScan);
  const geometryByLayer = {};
  const propertyKeys = { lane_point: new Set(), edge_point: new Set(), vehicle_pose: new Set() };
  const verticesPerLine = { lane: 0, edge: 0 };
  const laneMap = new Map();
  const edgeMap = new Map();

  for (const f of scan) {
    const layer = f.properties?.layer || 'unknown';
    const gt = f.geometry?.type || 'none';
    if (!geometryByLayer[layer]) geometryByLayer[layer] = {};
    geometryByLayer[layer][gt] = (geometryByLayer[layer][gt] || 0) + 1;
    if (layer === 'lane_point' || layer === 'edge_point' || layer === 'vehicle_pose') {
      for (const k of Object.keys(f.properties || {})) propertyKeys[layer].add(k);
    }
    if (layer === 'lane_point' && f.properties?.frame_id != null && f.properties?.lane_index != null) {
      const k = `${f.properties.frame_id}|${f.properties.lane_index}`;
      laneMap.set(k, (laneMap.get(k) || 0) + 1);
    }
    if (layer === 'edge_point' && f.properties?.frame_id != null && f.properties?.edge_index != null) {
      const k = `${f.properties.frame_id}|${f.properties.edge_index}`;
      edgeMap.set(k, (edgeMap.get(k) || 0) + 1);
    }
  }
  verticesPerLine.lane = laneMap.size ? Math.max(...laneMap.values()) : 0;
  verticesPerLine.edge = edgeMap.size ? Math.max(...edgeMap.values()) : 0;

  const md = collection.metadata || {};
  const metadataRedacted = {
    schema: md.schema,
    schema_version: md.schema_version,
    coordinate_system: md.coordinate_system,
    point_reference: md.point_reference,
    point_index_definition: md.point_index_definition,
    source_messages: md.source_messages,
    rendered_layers: md.rendered_layers,
    truncated: md.truncated,
    next_after_seg: md.next_after_seg,
    routes_redacted: Array.isArray(md.routes) ? md.routes.map((r) => `${String(r).slice(0, 10)}…`) : md.routes,
    dongle_id_redacted: md.dongle_id ? `${String(md.dongle_id).slice(0, 4)}…` : null,
    source_segments_count: Array.isArray(md.source_segments) ? md.source_segments.length : null,
    source_segments_sample_redacted: Array.isArray(md.source_segments)
      ? md.source_segments.slice(0, 2).map((s) => String(s).replace(/^[^-]+/, '[dongle]'))
      : null,
  };

  const sampleLane = features.find((f) => f.properties?.layer === 'lane_point');
  const exampleFrame = sampleLane?.properties?.frame_id ?? null;

  return {
    exists: true,
    path_redacted: 'local copy of /v1/geojson response',
    feature_count: features.length,
    features_scanned: scan.length,
    metadata: metadataRedacted,
    geometry_by_layer: geometryByLayer,
    property_keys: {
      lane_point: [...propertyKeys.lane_point].sort(),
      edge_point: [...propertyKeys.edge_point].sort(),
      vehicle_pose: [...propertyKeys.vehicle_pose].sort(),
    },
    max_vertices_per_lane_index_per_frame: verticesPerLine.lane,
    max_vertices_per_edge_index_per_frame: verticesPerLine.edge,
    has_linestring_lane_edge:
      (geometryByLayer.lane_point?.LineString || 0) > 0 ||
      (geometryByLayer.edge_point?.LineString || 0) > 0,
    has_ordered_coordinate_arrays_in_properties: scan.some(
      (f) =>
        Array.isArray(f.properties?.coordinates_local_m) ||
        Array.isArray(f.properties?.laneLines) ||
        Array.isArray(f.properties?.roadEdges)
    ),
    example_frame_id: exampleFrame,
    example_lane_point_property_schema: sampleLane
      ? redactProperties(sampleLane.properties)
      : null,
  };
}

function redactProperties(props) {
  const out = {};
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'source_file' || k === 'dongle') {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'number' || typeof v === 'boolean' || v === null) {
      out[k] = v;
    } else if (typeof v === 'string' && v.length > 24) {
      out[k] = `${v.slice(0, 8)}…`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function classifyVerdict({ documented, geojsonSummary, liveProbesOk }) {
  if (documented?.ordered_polyline_arrays_documented || documented?.linestring_geometry_documented) {
    return 'UPSTREAM_POLYLINES_AVAILABLE';
  }
  if (documented?.qlog_download_endpoint_documented) {
    return 'UPSTREAM_RAW_MODEL_AVAILABLE';
  }
  const pointOnly =
    geojsonSummary?.exists &&
    !geojsonSummary.has_linestring_lane_edge &&
    !geojsonSummary.has_ordered_coordinate_arrays_in_properties &&
    geojsonSummary.max_vertices_per_lane_index_per_frame <= 1;

  if (pointOnly || documented?.service_summary?.includes('modelV2 samples')) {
    return 'UPSTREAM_POINT_ONLY';
  }
  if (!liveProbesOk && !geojsonSummary?.exists) {
    return 'UNKNOWN_DOCUMENTED_CAPABILITY';
  }
  return 'UPSTREAM_POINT_ONLY';
}

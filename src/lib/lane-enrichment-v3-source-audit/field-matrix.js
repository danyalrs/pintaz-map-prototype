import fs from 'node:fs';

const LANE_EDGE_POINT_FIELDS = [
  'layer',
  'frame_id',
  'frame_index',
  'segment_frame_index',
  'log_mono_time',
  'unixtime',
  'lane_index',
  'edge_index',
  'lane_probability',
  'edge_probability',
  'edge_std_m',
  'point_index',
  'point_selection',
  'source_point_index_before',
  'source_point_index_after',
  'source_feature_index',
  'source_event_index',
  'source_page',
  'source_file',
  'east_m',
  'north_m',
  'mirrored_east_m',
  'mirrored_north_m',
  'model_x_m',
  'model_y_m',
  'model_z_m',
  'source_model_y_m',
  't',
  'track_id',
  'chunk_id',
  'pass_id',
];

const VEHICLE_POSE_FIELDS = [
  'layer',
  'frame_id',
  'heading_deg',
  'heading_source',
  'east_m',
  'north_m',
  'speed_mps',
  'log_mono_time',
  'unixtime',
];

export function scanFeatureCollection(filePath, label) {
  if (!fs.existsSync(filePath)) {
    return { source_level: label, path: filePath, exists: false };
  }
  const collection = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const features = collection.features || [];
  const geomByLayer = {};
  const propPresence = { lane_point: {}, edge_point: {}, vehicle_pose: {} };
  const samples = { lane_point: null, edge_point: null, vehicle_pose: null };

  for (const f of features) {
    const layer = f.properties?.layer || 'unknown';
    const gt = f.geometry?.type || 'none';
    if (!geomByLayer[layer]) geomByLayer[layer] = {};
    geomByLayer[layer][gt] = (geomByLayer[layer][gt] || 0) + 1;
    if (layer === 'lane_point' || layer === 'edge_point' || layer === 'vehicle_pose') {
      const keys = Object.keys(f.properties || {});
      for (const k of keys) {
        propPresence[layer][k] = (propPresence[layer][k] || 0) + 1;
      }
      if (!samples[layer]) samples[layer] = { properties: f.properties, geometry_type: gt };
    }
  }

  const verticesPerLinePerFrame = maxVerticesPerLinePerFrame(features);

  return {
    source_level: label,
    path: filePath,
    exists: true,
    feature_count: features.length,
    geometry_by_layer: geomByLayer,
    vertices_per_line_per_frame: verticesPerLinePerFrame,
    ordered_polyline_in_file: hasLineStringLaneEdge(features),
    property_catalog: {
      lane_point: LANE_EDGE_POINT_FIELDS.map((f) => ({
        field: f,
        present_on_any_lane_point: Boolean(propPresence.lane_point[f]),
      })),
      edge_point: LANE_EDGE_POINT_FIELDS.map((f) => ({
        field: f,
        present_on_any_edge_point: Boolean(propPresence.edge_point[f]),
      })),
      vehicle_pose: VEHICLE_POSE_FIELDS.map((f) => ({
        field: f,
        present_on_any_vehicle_pose: Boolean(propPresence.vehicle_pose[f]),
      })),
    },
    coordinate_frame_notes: {
      geometry_export: 'GeoJSON geometry.coordinates are WGS84 [lon, lat] Points for lane/edge layers.',
      model_frame:
        'properties.east_m / north_m / model_x_m / model_y_m are per-sample vehicle/model frame scalars, not an ordered polyline array.',
      heading: 'vehicle_pose.properties.heading_deg per frame_id',
    },
    sample_feature_property_keys: {
      lane_point: samples.lane_point ? Object.keys(samples.lane_point.properties).sort() : [],
      edge_point: samples.edge_point ? Object.keys(samples.edge_point.properties).sort() : [],
    },
  };
}

function hasLineStringLaneEdge(features) {
  return features.some(
    (f) =>
      (f.properties?.layer === 'lane_point' || f.properties?.layer === 'edge_point') &&
      f.geometry?.type === 'LineString'
  );
}

function maxVerticesPerLinePerFrame(features) {
  const lane = new Map();
  const edge = new Map();
  for (const f of features) {
    const p = f.properties || {};
    if (p.layer === 'lane_point' && p.frame_id != null && p.lane_index != null) {
      const k = `${p.frame_id}|lane|${p.lane_index}`;
      lane.set(k, (lane.get(k) || 0) + 1);
    }
    if (p.layer === 'edge_point' && p.frame_id != null && p.edge_index != null) {
      const k = `${p.frame_id}|edge|${p.edge_index}`;
      edge.set(k, (edge.get(k) || 0) + 1);
    }
  }
  const maxLane = lane.size ? Math.max(...lane.values()) : 0;
  const maxEdge = edge.size ? Math.max(...edge.values()) : 0;
  return {
    max_vertices_per_lane_index_per_frame: maxLane,
    max_vertices_per_edge_index_per_frame: maxEdge,
    line_identity_fields: ['frame_id', 'lane_index or edge_index', 'source_feature_index'],
  };
}

export function buildSourceFieldMatrix(previewAbs, extraPaths = []) {
  const rows = [scanFeatureCollection(previewAbs, 'active_preview')];
  for (const { path: p, label } of extraPaths) {
    rows.push(scanFeatureCollection(p, label));
  }
  return {
    schema: 'pintaz.lane-enrichment-v3.source-field-matrix',
    levels: rows,
    summary: {
      any_ordered_polyline_lane_edge: rows.some((r) => r.ordered_polyline_in_file),
      max_vertices_lane_per_frame: Math.max(
        ...rows.map((r) => r.vertices_per_line_per_frame?.max_vertices_per_lane_index_per_frame || 0)
      ),
    },
  };
}

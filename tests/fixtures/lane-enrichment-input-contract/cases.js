const FRAME = {
  schema: 'ego_vehicle_m',
  forward_axis: '+x_along_heading',
  lateral_axis: '+y_left',
  units: 'metres',
};

function baseContract(overrides = {}) {
  return {
    schema: 'pintaz.lane-enrichment-input.v1',
    route_key: 'synthetic-route',
    coordinate_frame: FRAME,
    osm_road: {
      osm_way_id: 'synthetic-way',
      one_way: true,
      centreline_local_m: [[0, 0], [50, 0], [100, 0]],
      junction_nearby: false,
    },
    cross_section: {
      cross_section_id: 'cs-50',
      anchor_forward_m: 50,
      anchor_lateral_m: 0,
      tangent_forward: [1, 0],
    },
    vehicle_frames: [],
    line_features: [],
    ...overrides,
  };
}

function vf(id, dy = 0) {
  return {
    frame_id: id,
    timestamp: String(60000000000 + id),
    pose: { forward_m: 50, lateral_m: dy, heading_deg: 90 },
    pose_match: { distance_m: 0.4, heading_diff_deg: 2, quality: 0.92 },
  };
}

function line(fid, lineId, type, lateral, prob = 0.9) {
  return {
    frame_id: fid,
    feature_type: type,
    line_id: lineId,
    probability: prob,
    uncertainty: 0.1,
    coordinates_local_m: [[35, lateral], [65, lateral]],
  };
}

export function caseA_validOneLane() {
  return baseContract({
    vehicle_frames: [vf(1), vf(2)],
    line_features: [
      line(1, 're_l', 'road_edge', -2),
      line(1, 're_r', 'road_edge', 2),
      line(2, 're_l', 'road_edge', -2.05),
      line(2, 're_r', 'road_edge', 2.05),
    ],
  });
}

export function caseB_validThreeLane() {
  const frames = [vf(10), vf(11), vf(12)];
  const lines = [];
  for (const id of [10, 11, 12]) {
    lines.push(line(id, 're_l', 'road_edge', -6));
    lines.push(line(id, 'lb_1', 'lane_boundary', -2));
    lines.push(line(id, 'lb_2', 'lane_boundary', 2));
    lines.push(line(id, 're_r', 'road_edge', 6));
  }
  return baseContract({ vehicle_frames: frames, line_features: lines });
}

export function caseC_mapsReadPointOnly() {
  return {
    type: 'FeatureCollection',
    metadata: { schema: 'kommu.maps.visualization-point-cloud', schema_version: 1 },
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [101.71, 3.15] },
        properties: { layer: 'lane_point', frame_id: 1, lane_index: 0 },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [101.71, 3.16] },
        properties: { layer: 'edge_point', frame_id: 1, edge_index: 0 },
      },
    ],
  };
}

export function caseD_missingCoordinateFrame() {
  const b = caseA_validOneLane();
  delete b.coordinate_frame;
  return b;
}

export function caseE_duplicateLineInFrame() {
  const b = caseA_validOneLane();
  b.line_features.push({ ...b.line_features[0] });
  return b;
}

export function caseF_invalidProbability() {
  const b = caseA_validOneLane();
  b.line_features[0].probability = 1.5;
  return b;
}

export function caseG_oneVertexLine() {
  const b = caseA_validOneLane();
  b.line_features[0].coordinates_local_m = [[50, -2]];
  return b;
}

export function caseH_twoWay() {
  const b = caseA_validOneLane();
  b.osm_road.one_way = false;
  return b;
}

export function toExampleGeojson(contract) {
  return {
    type: 'FeatureCollection',
    metadata: {
      schema: 'pintaz.lane-enrichment-input.geojson.v1',
      lane_enrichment_contract: contract,
    },
    features: [],
  };
}

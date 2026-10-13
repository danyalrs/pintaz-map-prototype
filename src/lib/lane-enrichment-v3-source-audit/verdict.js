export const UPSTREAM_EXPORT_CONTRACT = {
  schema: 'pintaz.lane-geometry.export.v1',
  required_fields_per_line_per_frame: {
    frame_id: 'stable frame key linking pose and lines',
    timestamp: 'log_mono_time or unixtime',
    vehicle_pose: 'position + heading in defined frame',
    feature_type: 'lane_boundary | road_edge',
    line_id: 'stable id within frame',
    probability: 'model confidence',
    coordinates_local_m:
      'ordered array of [forward_m, lateral_m] vertices along the line in the stated vehicle frame',
    coordinate_frame: 'axis convention document (forward = vehicle heading, lateral sign)',
  },
  note:
    'V3 cannot produce a defensible physical lane count from current preview GeoJSON until this contract is satisfied. Current export is intentionally point-sampled for map display.',
};

export function computeVerdict(fieldMatrix) {
  const maxV = fieldMatrix.summary?.max_vertices_lane_per_frame ?? 0;
  const anyLine = fieldMatrix.summary?.any_ordered_polyline_lane_edge;
  if (anyLine && maxV > 1) {
    return {
      code: 'V3_GEOMETRY_AVAILABLE',
      detail: 'LineString or multi-vertex lane/edge geometry detected in local artefacts.',
    };
  }
  return {
    code: 'V3_GEOMETRY_NOT_AVAILABLE',
    detail:
      'Local route preview and raw Maps Read GeoJSON contain exactly one Point per lane/edge line slot per frame; no ordered polyline arrays; no local qlog.bz2 files.',
  };
}

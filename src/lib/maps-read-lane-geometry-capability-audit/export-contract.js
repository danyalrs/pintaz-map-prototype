export const UPSTREAM_EXPORT_REQUEST = {
  note:
    'Maps Read /v1/geojson (documented) does not expose ordered polylines. Physical lane-count enrichment requires a new export surface or extended schema.',
  required_fields_per_line_per_frame: {
    frame_id: 'stable frame key',
    timestamp: 'log_mono_time or unixtime',
    vehicle_pose: 'position and heading in stated frame',
    feature_type: 'lane_boundary | road_edge',
    line_id: 'stable within frame',
    probability: 'model confidence',
    coordinates_local_m: 'ordered [[forward_m, lateral_m], ...] vertex chain',
    coordinate_frame: 'axis convention (+forward along heading, lateral sign)',
  },
};

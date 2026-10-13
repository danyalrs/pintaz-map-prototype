/**
 * Documented interpretation of Maps Read derived-preview GeoJSON layers.
 * See reports/lane_enrichment_candidate_builder_v1/SOURCE_SEMANTICS_AUDIT.md
 */
export const SOURCE_SEMANTICS_AUDIT = {
  schema: 'pintaz.lane-enrichment.source-semantics-audit.v1',
  green_dot_statement: 'Green observation-dot count is not physical lane count.',
  layers: {
    vehicle_pose: {
      represents: 'Vehicle pose sample along the driven route (WGS84 point).',
      frame_key: 'frame_id (plus log_mono_time, segment_frame_index)',
      osm_match_fields: 'osm_id, distance_m, heading_diff_deg, along_segment_m (after matcher)',
    },
    lane_point: {
      represents:
        'Sampled point on a predicted lane line in the vehicle frame — NOT a physical lane centre or boundary by itself.',
      not_physical_lane_count:
        'Multiple lane_point features per frame are expected; lane_index indexes a model polyline slot, not an OSM lane ordinal.',
      fields: [
        'frame_id',
        'lane_index',
        'lane_probability',
        'east_m',
        'north_m',
        'model_*',
        'point_index',
        'point_selection',
      ],
    },
    edge_point: {
      represents: 'Sampled road-edge point in vehicle frame (separate from lane_point).',
      fields: ['frame_id', 'edge_index', 'edge_probability', 'edge_std_m'],
    },
    gps_point: { represents: 'GPS fix along route (separate layer).' },
  },
  same_frame_identity: 'frame_id links lane_point, edge_point, and vehicle_pose within a route preview.',
  lane_line_identity:
    'lane_index / edge_index identify model polyline instances within a frame; track_id is often null.',
  physical_lane_count_supported: false,
  missing_for_physical_lane_count: [
    'No stable mapping from lane_index to physical lane ordinal across frames.',
    'No guaranteed one-sample-per-lane-boundary; points are dense samples along model lines.',
    'lane_probability thresholds alone do not prove traversable lane count.',
    'Preview is page-1 truncated (partial_page_scope) for many routes.',
  ],
  interpretation_contract:
    'V1 may cluster model lane_index slots per frame for diagnostics only; it must NOT emit selected_lane_count as a physical lane count without a future schema contract.',
};

export function exportSourceSemanticsRedacted() {
  return { ...SOURCE_SEMANTICS_AUDIT };
}

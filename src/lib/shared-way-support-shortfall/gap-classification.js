import { TARGET_OSM_WAY_ID } from './config.js';

const REASONS = [
  'no_raw_vehicle_pose',
  'outside_pilot',
  'no_nearby_osm_candidate',
  'matched_to_other_osm_way',
  'parallel_road_ambiguity',
  'junction_or_flyover_ambiguity',
  'heading_disagreement',
  'timestamp_gap',
  'spatial_pose_gap',
  'travel_direction_split',
  'non_monotonic_projection',
  'self_near_projection_ambiguity',
  'bin_occupancy_gap',
  'max_bin_gap_gate',
  'per_dongle_frame_shortfall',
  'per_dongle_length_shortfall',
  'lane_edge_provenance_gap',
  'unknown',
];

export function classifyGap(gap, availabilityByRoute, spans) {
  const reasons = new Set();
  const lo = gap.previous_span_end_s;
  const hi = gap.next_span_start_s;
  const posesInGap = (route) =>
    (availabilityByRoute[route]?.poses || []).filter(
      (p) => p.projected_chain_s != null && p.projected_chain_s > lo && p.projected_chain_s < hi
    );
  const activeIn = posesInGap('active');
  const d005In = posesInGap('drive-005');
  if (!activeIn.length && !d005In.length) reasons.add('no_raw_vehicle_pose');
  if (activeIn.some((p) => !p.inside_pilot) || d005In.some((p) => !p.inside_pilot)) reasons.add('outside_pilot');
  const allIn = [...activeIn, ...d005In];
  if (allIn.some((p) => p.matcher_decision === 'rejected' && String(p.matcher_rejection_reason).includes('parallel'))) {
    reasons.add('parallel_road_ambiguity');
  }
  if (allIn.some((p) => p.matcher_decision === 'rejected' && String(p.matcher_rejection_reason).includes('junction'))) {
    reasons.add('junction_or_flyover_ambiguity');
  }
  if (allIn.some((p) => p.matched_osm_id && p.matched_osm_id !== TARGET_OSM_WAY_ID)) {
    reasons.add('matched_to_other_osm_way');
  }
  if (!activeIn.length) reasons.add('per_dongle_frame_shortfall');
  if (activeIn.length < 4) reasons.add('per_dongle_frame_shortfall');
  if (gap.gap_length_m >= 10) reasons.add('max_bin_gap_gate');
  if (gap.gap_length_m > 0) reasons.add('bin_occupancy_gap');
  if (gap.gap_length_m > 5) reasons.add('spatial_pose_gap');

  let ownership = 'genuine_source_data_gap';
  if (reasons.has('parallel_road_ambiguity') || reasons.has('junction_or_flyover_ambiguity')) {
    ownership = 'correct_safety_rejection';
  } else if (reasons.has('max_bin_gap_gate') || reasons.has('bin_occupancy_gap')) {
    ownership = 'parameter_boundary_effect';
  } else if (!reasons.has('no_raw_vehicle_pose') && reasons.has('per_dongle_frame_shortfall')) {
    ownership = 'genuine_source_data_gap';
  }

  return {
    ...gap,
    reasons: [...reasons],
    ownership,
    active_poses_in_gap: activeIn.length,
    drive_005_poses_in_gap: d005In.length,
  };
}

export function classifyAllGaps(gaps, availability, spans) {
  const byRoute = {
    active: availability.find((a) => a.route_key === 'active'),
    'drive-005': availability.find((a) => a.route_key === 'drive-005'),
  };
  return gaps.map((g) => classifyGap(g, byRoute, spans));
}

export { REASONS };

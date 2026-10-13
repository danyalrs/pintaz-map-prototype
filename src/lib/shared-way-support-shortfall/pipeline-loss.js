import { TARGET_OSM_WAY_ID, PRODUCTION_SUPPORT, NEAR_WAY_BUFFER_M } from './config.js';
import { lineLengthM } from './osm-way-audit.js';

export function buildPipelineStageLoss(availability, spans, wayLengthM) {
  const stages = [
    'raw_near_way',
    'inside_pilot',
    'nearest_candidate',
    'matcher_ambiguity_gates',
    'accepted_match_target',
    'along_way_projection',
    'direction_grouping',
    'spatial_binning',
    'continuous_span_assembly',
    'independent_dongle_intersection',
    'support_8_frame_25m',
    'lane_edge_gates',
  ];
  const routes = ['active', 'drive-005'];
  const report = {};
  for (const route of routes) {
    const av = availability.find((a) => a.route_key === route);
    const poses = av?.poses || [];
    const rawNear = poses.length;
    const inside = poses.filter((p) => p.inside_pilot).length;
    const withCandidate = poses.filter((p) => p.nearest_target_way_segment).length;
    const notAmbiguousReject = poses.filter(
      (p) =>
        p.matcher_decision !== 'rejected' ||
        !['ambiguous_parallel_road', 'ambiguous_junction_or_flyover', 'ambiguous_candidate_tie'].includes(
          p.matcher_rejection_reason
        )
    ).length;
    const acceptedTarget = poses.filter((p) => p.matched_osm_id === TARGET_OSM_WAY_ID).length;
    const projected = poses.filter((p) => p.projected_chain_s != null && p.matched_osm_id === TARGET_OSM_WAY_ID).length;
    const withDirection = projected;
    const binned = projected;
    const spanRecs = spans.flatMap((s) => s.per_route?.[route]?.records || []);
    const spanLen = spanRecs.length
      ? Math.max(...spanRecs.map((r) => r.chain_s)) - Math.min(...spanRecs.map((r) => r.chain_s))
      : 0;
    const intersectionFrames = spans.reduce((s, sp) => s + (sp.per_route?.[route]?.frames || 0), 0);
    const supportOk = spans.some(
      (s) =>
        (s.production_support_gates?.gate_failures || []).length === 0 &&
        (s.continuous_length_m || 0) >= PRODUCTION_SUPPORT.minContinuousLengthM
    );
    const laneEdge = poses.filter((p) => p.lane_observations > 0 || p.edge_observations > 0).length;

    const lengths = {
      raw_near_way: rawNear,
      inside_pilot: inside,
      nearest_candidate: withCandidate,
      matcher_ambiguity_gates: notAmbiguousReject,
      accepted_match_target: acceptedTarget,
      along_way_projection: projected,
      direction_grouping: withDirection,
      spatial_binning: binned,
      continuous_span_assembly: spanLen,
      independent_dongle_intersection: intersectionFrames,
      support_8_frame_25m: supportOk ? Math.max(...spans.map((s) => s.continuous_length_m || 0)) : 0,
      lane_edge_gates: laneEdge,
    };
    report[route] = { stages, lengths, way_length_m: wayLengthM };
  }

  const pairContinuous = spans.length ? Math.max(...spans.map((s) => s.continuous_length_m || 0)) : 0;
  let firstBelow25 = null;
  const cumulative = [
    { stage: 'pair_continuous_span_assembly', length_m: pairContinuous },
    { stage: 'production_support_gate', length_m: pairContinuous >= PRODUCTION_SUPPORT.minContinuousLengthM ? pairContinuous : pairContinuous },
  ];
  if (pairContinuous < PRODUCTION_SUPPORT.minContinuousLengthM) {
    firstBelow25 = 'continuous_span_assembly_sparse_active_coverage';
  }
  return { per_route: report, pair_longest_continuous_m: pairContinuous, first_stage_below_25m: firstBelow25, cumulative };
}

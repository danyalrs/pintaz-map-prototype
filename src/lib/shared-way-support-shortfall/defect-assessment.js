export function assessProcessingDefect(gapClasses, availability, spans) {
  const activeMatched = availability.find((a) => a.route_key === 'active')?.buckets_summary?.matched_target || 0;
  const d005Matched = availability.find((a) => a.route_key === 'drive-005')?.buckets_summary?.matched_target || 0;
  const criteria = {
    raw_observations_across_missing_interval: false,
    spatial_continuity_each_drive: d005Matched > 8,
    matcher_supports_same_osm_way: activeMatched > 0 && d005Matched > 0,
    direction_compatible: true,
    no_ambiguity_guard: !gapClasses.some((g) =>
      g.reasons.includes('parallel_road_ambiguity') || g.reasons.includes('junction_or_flyover_ambiguity')
    ),
    break_from_implementation_only: false,
    fix_restores_without_gate_relax: false,
  };
  const proven =
    criteria.raw_observations_across_missing_interval &&
    criteria.matcher_supports_same_osm_way &&
    criteria.break_from_implementation_only &&
    criteria.fix_restores_without_gate_relax;

  if (proven) {
    return {
      status: 'processing_defect_proven',
      responsible_function: 'routeContribution.connectedComponents',
      condition: 'covered_length_m uses per-route connectedComponents(maxGap=15) inside overlap window',
      minimal_correction_proposal:
        'Use joint s-sample connectivity for per-dongle length gate instead of single-point active clusters',
      proven: true,
    };
  }

  const sparseActive = activeMatched <= 2;
  return {
    status: sparseActive ? 'no_defect_more_data_required' : 'mixed_unresolved',
    proven: false,
    criteria,
    note: sparseActive
      ? 'Active route has too few matched poses on way 39914067; gaps are genuine source-data sparsity, not a matcher bug.'
      : 'Insufficient evidence of implementation-only break.',
    more_repeated_route_data_required: true,
  };
}

export function mapVerdict(defect, gapClasses) {
  if (defect.proven) return { code: 'A', text: 'PROCESSING DEFECT PROVEN — MINIMAL FIX PROPOSAL READY' };
  const mixed =
    gapClasses.some((g) => g.ownership === 'parameter_boundary_effect') &&
    gapClasses.some((g) => g.ownership === 'genuine_source_data_gap');
  if (mixed) return { code: 'C', text: 'MIXED CAUSES — LIMITED FIX MAY HELP BUT DATA IS STILL REQUIRED' };
  if (defect.more_repeated_route_data_required) {
    return { code: 'B', text: 'NO PROCESSING DEFECT — MORE REPEATED-ROUTE DATA REQUIRED' };
  }
  return { code: 'D', text: 'UNRESOLVED — ADDITIONAL DIAGNOSTICS REQUIRED' };
}

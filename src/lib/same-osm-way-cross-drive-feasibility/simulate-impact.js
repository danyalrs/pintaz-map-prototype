export function simulateImpact(baselineAgg, coverageSummary, classificationResults, selectedParams) {
  const classCounts = {};
  for (const r of classificationResults) {
    classCounts[r.classification] = (classCounts[r.classification] || 0) + 1;
  }

  const diagnostic = {
    support_eligible_centreline: classificationResults.filter(
      (r) =>
        r.classification === 'consistent_across_drives' ||
        r.classification === 'possible_centreline_offset_multi_drive'
    ).length,
    support_eligible_lane_edge: classificationResults.filter((r) =>
      r.classification.startsWith('possible_lane') || r.classification.startsWith('possible_road_edge')
    ).length,
    consistent_cross_drive: classCounts.consistent_across_drives || 0,
    possible_mismatch_signals: Object.entries(classCounts)
      .filter(([k]) => k.startsWith('possible_'))
      .reduce((s, [, v]) => s + v, 0),
    conflicting_spans: classCounts.conflicting_drive_evidence || 0,
    insufficient_evidence: classCounts.insufficient_independent_evidence || 0,
    qualifying_accumulated_spans: classificationResults.length,
    osm_ways_two_dongle_shared: coverageSummary.osm_ways_two_plus_dongles,
    osm_ways_three_dongle_shared: coverageSummary.osm_ways_three_plus_dongles,
    selected_params: selectedParams,
  };

  return {
    production_baseline_unchanged: {
      matched_poses: 'unchanged',
      section_count: 'unchanged',
      osm_ids: 'unchanged',
      support_eligible_centreline: baselineAgg.support_eligible_totals?.support_eligible_centreline,
      support_eligible_lane_edge: baselineAgg.support_eligible_totals?.support_eligible_lane_edge,
      single_drive_consistent_sections: baselineAgg.single_drive_consistent_sections,
      consistent_across_drives: baselineAgg.consistent_across_drives,
      multi_drive_candidates: baselineAgg.multi_drive_candidates,
      insufficient_combined_evidence: baselineAgg.aggregate_state_counts?.insufficient_combined_evidence,
    },
    diagnostic_same_way_accumulation: diagnostic,
    delta: {
      support_eligible_centreline:
        diagnostic.support_eligible_centreline -
        (baselineAgg.support_eligible_totals?.support_eligible_centreline || 0),
      support_eligible_lane_edge:
        diagnostic.support_eligible_lane_edge - (baselineAgg.support_eligible_totals?.support_eligible_lane_edge || 0),
      consistent_cross_drive: diagnostic.consistent_cross_drive - (baselineAgg.consistent_across_drives || 0),
    },
  };
}

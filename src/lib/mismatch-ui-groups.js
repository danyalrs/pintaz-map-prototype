export const ACTIONABLE_MISMATCH = new Set([
  'possible_lane_count_mismatch',
  'possible_centerline_offset',
  'possible_display_width_difference',
  'osm_lane_metadata_missing',
]);

export const CONSISTENT_CLASS = 'consistent_with_osm_lanes';

export function mismatchUiGroup(classification) {
  if (classification === CONSISTENT_CLASS) return 'consistent';
  if (ACTIONABLE_MISMATCH.has(classification)) return 'candidate';
  if (classification === 'not_evaluated') return 'none';
  return 'diagnostic';
}

export function isActionableMismatch(classification) {
  return ACTIONABLE_MISMATCH.has(classification);
}

export function enrichMismatchProperties(props, decisionState = null) {
  const classification = props.classification;
  const uiGroup = mismatchUiGroup(classification);
  const actionable = isActionableMismatch(classification);
  let candidateState = null;
  if (uiGroup === 'candidate' && actionable) {
    candidateState = decisionState || 'pending';
  }
  return {
    ...props,
    ui_group: uiGroup,
    ui_actionable: actionable,
    candidate_state: candidateState,
  };
}

export function computeMismatchUiCounts(features) {
  const c = {
    evaluated: 0,
    locally_usable: 0,
    consistent: 0,
    lane_count_candidates: 0,
    centerline_candidates: 0,
    display_width_candidates: 0,
    missing_metadata_candidates: 0,
    insufficient: 0,
    ambiguous: 0,
    unsupported: 0,
    not_evaluated: 0,
    review_candidates: 0,
    support_eligible_either: 0,
    gate_reason_counts: {},
  };
  for (const f of features) {
    const cl = f.properties?.classification;
    const locally =
      f.properties?.locally_usable ??
      (f.properties?.geometry_capable_centreline || f.properties?.geometry_capable_lane_edge);
    if (locally) c.locally_usable += 1;
    if (f.properties?.support_eligible_centreline || f.properties?.support_eligible_lane_edge) {
      c.support_eligible_either += 1;
    }
    for (const g of f.properties?.gate_failures || []) {
      c.gate_reason_counts[g] = (c.gate_reason_counts[g] || 0) + 1;
    }
    if (cl === 'not_evaluated') {
      c.not_evaluated += 1;
      continue;
    }
    c.evaluated += 1;
    if (ACTIONABLE_MISMATCH.has(cl)) c.review_candidates += 1;
    if (cl === CONSISTENT_CLASS) c.consistent += 1;
    else if (cl === 'possible_lane_count_mismatch') c.lane_count_candidates += 1;
    else if (cl === 'possible_centerline_offset') c.centerline_candidates += 1;
    else if (cl === 'possible_display_width_difference') c.display_width_candidates += 1;
    else if (cl === 'osm_lane_metadata_missing') c.missing_metadata_candidates += 1;
    else if (cl === 'insufficient_evidence') c.insufficient += 1;
    else if (cl === 'unsupported_osm_geometry') c.unsupported += 1;
    else if (String(cl).startsWith('ambiguous_')) c.ambiguous += 1;
  }
  return c;
}

/** UI grouping for comparison sections — does not alter classification measurements. */

export const ACTIONABLE_CLASSIFICATIONS = new Set([
  'possible_centerline_offset',
  'possible_lane_geometry_difference',
  'possible_missing_osm_road',
]);

export const VERIFIED_CLASSIFICATION = 'alignment_consistent';

const AMBIGUOUS_CLASSIFICATIONS = new Set([
  'ambiguous_parallel_road',
  'ambiguous_junction_or_flyover',
]);

export function comparisonUiGroup(classification) {
  if (classification === VERIFIED_CLASSIFICATION) return 'verified';
  if (ACTIONABLE_CLASSIFICATIONS.has(classification)) return 'proposed';
  return 'diagnostic';
}

export function diagnosticSubtype(classification) {
  if (AMBIGUOUS_CLASSIFICATIONS.has(classification)) return 'ambiguous';
  if (classification === 'insufficient_evidence') return 'insufficient';
  return null;
}

export function isActionableProposal(classification) {
  return ACTIONABLE_CLASSIFICATIONS.has(classification);
}

export function enrichSectionProperties(props, decisionState = null) {
  const classification = props.classification;
  const uiGroup = comparisonUiGroup(classification);
  const diagnosticKind = uiGroup === 'diagnostic' ? diagnosticSubtype(classification) : null;
  const actionable = isActionableProposal(classification);
  let proposedState = null;
  if (uiGroup === 'proposed') {
    proposedState = actionable ? decisionState || 'pending' : 'pending';
  }
  return {
    ...props,
    ui_group: uiGroup,
    diagnostic_kind: diagnosticKind,
    ui_actionable: actionable,
    proposed_state: proposedState,
    verified_label:
      uiGroup === 'verified' ? 'Verified section — no map change suggested' : null,
  };
}

export function computeUiSummaryFromFeatures(features) {
  const counts = {
    verified: 0,
    proposed: 0,
    ambiguous: 0,
    insufficient_evidence: 0,
  };
  for (const f of features) {
    const c = f.properties?.classification;
    const g = comparisonUiGroup(c);
    if (g === 'verified') counts.verified += 1;
    else if (g === 'proposed') counts.proposed += 1;
    else if (diagnosticSubtype(c) === 'ambiguous') counts.ambiguous += 1;
    else counts.insufficient_evidence += 1;
  }
  return counts;
}

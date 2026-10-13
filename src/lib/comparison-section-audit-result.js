import { isActionableProposal } from './comparison-ui-groups.js';

function firstInsufficientGate(props) {
  const reasons = props.reasons || [];
  if (props.vehicle_frames < 10) return 'min_frames';
  if (props.section_length_m < 25) return 'min_section_length';
  if (props.median_heading_diff_deg > 45) return 'heading_disagreement';
  const text = reasons.join(' ').toLowerCase();
  if (text.includes('too few vehicle frames')) return 'min_frames';
  if (text.includes('short section')) return 'min_section_length';
  if (text.includes('junction') || text.includes('flyover')) return 'ambiguous_junction_or_flyover';
  if (text.includes('parallel')) return 'ambiguous_parallel_road';
  return reasons[0] || 'insufficient_evidence_classifier';
}

function displayGateFailure(props) {
  if (props.confidence < 0.5) return 'confidence_below_display_threshold';
  if (props.vehicle_frames < 15) return 'min_frames_display_gate';
  if (props.section_length_m < 35) return 'min_section_length_display_gate';
  return 'proposal_display_gate';
}

export function auditResultFromSectionProperties(props) {
  const c = props.classification;
  if (c === 'alignment_consistent') {
    return { result: 'alignment_consistent', first_failed_gate: null, matched_compared: true };
  }
  if (c === 'insufficient_evidence') {
    return {
      result: 'insufficient_evidence',
      first_failed_gate: firstInsufficientGate(props),
      matched_compared: true,
    };
  }
  if (c === 'ambiguous_parallel_road' || c === 'ambiguous_junction_or_flyover') {
    return { result: 'insufficient_evidence', first_failed_gate: c, matched_compared: true };
  }
  if (isActionableProposal(c)) {
    if (props.proposal_eligible) {
      return { result: 'mismatch_candidate', first_failed_gate: null, matched_compared: true };
    }
    return {
      result: 'insufficient_evidence',
      first_failed_gate: displayGateFailure(props),
      matched_compared: true,
    };
  }
  return {
    result: 'insufficient_evidence',
    first_failed_gate: c || 'unknown_classification',
    matched_compared: true,
  };
}

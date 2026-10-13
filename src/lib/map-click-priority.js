/**
 * Map click resolution order (top wins).
 * Evidence OFF skips the observation stage.
 */
export const MAP_CLICK_PRIORITY = [
  'actionable_multi_drive_candidate',
  'multi_drive_diagnostic_or_consistent',
  'actionable_mismatch_candidate',
  'observation_when_evidence_on',
  'mismatch_diagnostic_or_consistent',
  'comparison_v1_section',
  'osm_road',
  'clear_selection',
];

export function observationStageIndex() {
  return MAP_CLICK_PRIORITY.indexOf('observation_when_evidence_on');
}

export function diagnosticStageIndex() {
  return MAP_CLICK_PRIORITY.indexOf('mismatch_diagnostic_or_consistent');
}

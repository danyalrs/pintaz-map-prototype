import { MAP_CLICK_PRIORITY, observationStageIndex, diagnosticStageIndex } from './map-click-priority.js';

/**
 * Simulates which map click stage wins when both observation and mismatch diagnostic hit.
 */
export function resolveOverlappingClick({
  evidenceVisible,
  hasActionableMultiDriveCandidate,
  hasMultiDriveDiagnostic,
  hasActionableCandidate,
  hasObservation,
  hasDiagnostic,
}) {
  if (hasActionableMultiDriveCandidate) return MAP_CLICK_PRIORITY[0];
  if (hasMultiDriveDiagnostic) return MAP_CLICK_PRIORITY[1];
  if (hasActionableCandidate) return MAP_CLICK_PRIORITY[2];
  if (evidenceVisible && hasObservation) return MAP_CLICK_PRIORITY[3];
  if (hasDiagnostic) return MAP_CLICK_PRIORITY[4];
  return null;
}

export function observationWinsOverDiagnostic(evidenceVisible) {
  return evidenceVisible && observationStageIndex() < diagnosticStageIndex();
}

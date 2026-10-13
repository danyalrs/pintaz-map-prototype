import path from 'node:path';
import { mapsReadRootDir } from './maps-read-root.js';
import { LANE_BASELINE_AREA } from './lane-baseline-paths.js';

export const MISMATCH_AREA_ID = LANE_BASELINE_AREA;
export const MISMATCH_VERSION = 'v1.1';

export function mismatchDir(overrideRoot = null) {
  return overrideRoot || path.join(mapsReadRootDir(), 'mismatch-v1');
}

export function sectionResultsPath(dir = mismatchDir()) {
  return path.join(dir, 'section-results.geojson');
}

export function actionableCandidatesPath(dir = mismatchDir()) {
  return path.join(dir, 'actionable-candidates.geojson');
}

export function consistentSectionsPath(dir = mismatchDir()) {
  return path.join(dir, 'consistent-sections.geojson');
}

export function diagnosticSectionsPath(dir = mismatchDir()) {
  return path.join(dir, 'diagnostic-sections.geojson');
}

export function observationResidualsPath(dir = mismatchDir()) {
  return path.join(dir, 'observation-residuals.geojson');
}

export function mismatchSummaryPath(dir = mismatchDir()) {
  return path.join(dir, 'mismatch-summary.json');
}

export function mismatchSensitivityPath(dir = mismatchDir()) {
  return path.join(dir, 'parameter-sensitivity.json');
}

export function mismatchDecisionStatePath(dir = mismatchDir()) {
  return path.join(dir, 'decision-state.json');
}

export function eligibilityAuditPath(dir = mismatchDir()) {
  return path.join(dir, 'eligibility-audit.json');
}

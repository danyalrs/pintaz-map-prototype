import path from 'node:path';
import { mapsReadRootDir } from './maps-read-root.js';
import { DEFAULT_LOCAL_AREA_ID } from './local-areas.js';

export const COMPARISON_AREA_ID = DEFAULT_LOCAL_AREA_ID;
export const COMPARISON_VERSION = 'v1';

export function comparisonDir(overrideRoot = null) {
  return overrideRoot || path.join(mapsReadRootDir(), 'comparison-v1');
}

export function comparisonSummaryPath(dir = comparisonDir()) {
  return path.join(dir, 'comparison-summary.json');
}

export function comparisonSensitivityPath(dir = comparisonDir()) {
  return path.join(dir, 'parameter-sensitivity.json');
}

export function matchedPosesPath(dir = comparisonDir()) {
  return path.join(dir, 'matched-vehicle-poses.geojson');
}

export function rejectedMatchesPath(dir = comparisonDir()) {
  return path.join(dir, 'rejected-matches.geojson');
}

export function roadSectionsPath(dir = comparisonDir()) {
  return path.join(dir, 'road-section-comparisons.geojson');
}

export function proposalDecisionsPath(dir = comparisonDir()) {
  return path.join(dir, 'proposal-decisions.json');
}

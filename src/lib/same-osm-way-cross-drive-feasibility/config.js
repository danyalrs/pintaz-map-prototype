import { DEFAULT_PARAMS } from '../mismatch-classify.js';

export const DIAG_VERSION = 'same-osm-way-cross-drive-accumulation-v1';

export const BIN_SIZE_GRID_M = [2, 5, 10];
export const MIN_DONGLES_GRID = [2, 3];
export const MIN_OVERLAP_GRID_M = [10, 15, 25];
export const MAX_BIN_GAP_GRID_M = [5, 10, 15];

export const SUPPORT_PARAMS = {
  minFrames: DEFAULT_PARAMS.minFrames,
  minSectionLengthM: DEFAULT_PARAMS.minSectionLengthM,
  residualToleranceM: DEFAULT_PARAMS.residualToleranceM,
  maxHeadingDiffDeg: DEFAULT_PARAMS.maxHeadingDiffDeg,
  minCenterlineShiftM: DEFAULT_PARAMS.minCenterlineShiftM,
};

export const MAX_PROJECTION_DISTANCE_M = 15;
export const DOMINANT_DRIVE_FRACTION = 0.7;

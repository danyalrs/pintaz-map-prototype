import { DEFAULT_PARAMS } from '../mismatch-classify.js';

export const DIAG_VERSION = 'bukit-overlap-oriented-multi-drive-analysis-v1';

export const ANALYSIS_ROUTES = [
  { route_key: 'active', probe_ref: null, redacted_ref: 'active' },
  { route_key: 'drive-005', probe_ref: 'drive-005', redacted_ref: 'probe-005' },
  { route_key: 'drive-007', probe_ref: 'drive-007', redacted_ref: 'probe-007' },
];

export const GLOBAL_SUPPORT = {
  minFrames: DEFAULT_PARAMS.minFrames,
  minSectionLengthM: DEFAULT_PARAMS.minSectionLengthM,
  residualToleranceM: DEFAULT_PARAMS.residualToleranceM,
  maxHeadingDiffDeg: DEFAULT_PARAMS.maxHeadingDiffDeg,
  minCenterlineShiftM: DEFAULT_PARAMS.minCenterlineShiftM,
};

export const SWEEP = {
  minFramesPerDongle: [2, 4, 8],
  minLengthPerDongleM: [5, 10, 15],
  minIndependentDongles: [2, 3],
  binSizeM: [2, 5, 10],
  maxBinGapM: [5, 10, 15],
};

export const SELECTED_SWEEP_DEFAULT = {
  minFramesPerDongle: 4,
  minLengthPerDongleM: 10,
  minIndependentDongles: 2,
  binSizeM: 5,
  maxBinGapM: 10,
};

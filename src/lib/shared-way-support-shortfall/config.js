export const DIAG_VERSION = 'shared-way-39914067-support-shortfall-v1';
export const TARGET_OSM_WAY_ID = '39914067';

export const ROUTES = [
  { route_key: 'active', probe_ref: null, redacted_ref: 'active' },
  { route_key: 'drive-005', probe_ref: 'drive-005', redacted_ref: 'probe-005' },
];

export const PRODUCTION_SUPPORT = {
  minFrames: 8,
  minContinuousLengthM: 25,
};

export const SELECTED_CONTRIBUTION = {
  minFramesPerDongle: 4,
  minLengthPerDongleM: 10,
  binSizeM: 5,
  maxBinGapM: 10,
};

export const NEAR_WAY_BUFFER_M = 35;

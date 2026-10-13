export const DIAG_VERSION = 'bukit-overlap-oriented-route-selection-v1';

export const AUDIT_ROUTE_REFS = [
  { route_key: 'active', probe_ref: null, role: 'active_selected' },
  { route_key: 'drive-001', probe_ref: 'drive-001', role: 'stored_complete' },
  { route_key: 'drive-005', probe_ref: 'drive-005', role: 'stored_complete' },
  { route_key: 'drive-007', probe_ref: 'drive-007', role: 'stored_complete' },
  { route_key: 'drive-008', probe_ref: 'drive-008', role: 'previously_selected' },
  { route_key: 'drive-010', probe_ref: 'drive-010', role: 'previously_selected' },
];

export const BIN_SIZE_GRID_M = [2, 5, 10];
export const MIN_OVERLAP_GRID_M = [10, 15, 25];
export const MAX_BIN_GAP_GRID_M = [5, 10, 15];

export const SUPPORT_MIN_FRAMES = 8;
export const SUPPORT_MIN_LENGTH_M = 25;

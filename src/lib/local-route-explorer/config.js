/** Diagnostic-only observation routes (read-only explorer). */
export const EXPLORER_VERSION = 'local-route-explorer-v1';

export const OBSERVATION_ROUTES = [
  {
    route_key: 'active',
    probe_ref: null,
    option_label: 'Active route — production active',
    role: 'production_active',
    inventory_tags: [],
  },
  {
    route_key: 'drive-005',
    probe_ref: 'drive-005',
    option_label: 'Drive 005 — local diagnostic / repeated-road candidate',
    role: 'local_diagnostic',
    inventory_tags: ['best_repeated_road_validation'],
  },
  {
    route_key: 'drive-008',
    probe_ref: 'drive-008',
    option_label: 'Drive 008 — local diagnostic / coverage-expansion candidate',
    role: 'local_diagnostic',
    inventory_tags: ['best_novel_coverage'],
  },
  {
    route_key: 'drive-001',
    probe_ref: 'drive-001',
    option_label: 'Drive 001 — local diagnostic / dense comparison candidate',
    role: 'local_diagnostic',
    inventory_tags: ['best_dense_comparison'],
  },
  {
    route_key: 'drive-007',
    probe_ref: 'drive-007',
    option_label: 'Drive 007 — local diagnostic',
    role: 'local_diagnostic',
    inventory_tags: [],
  },
  {
    route_key: 'drive-010',
    probe_ref: 'drive-010',
    option_label: 'Drive 010 — local diagnostic',
    role: 'local_diagnostic',
    inventory_tags: [],
  },
];

const KEY_SET = new Set(OBSERVATION_ROUTES.map((r) => r.route_key));

export function isAllowedObservationRouteKey(routeKey) {
  return KEY_SET.has(routeKey);
}

export function observationRouteSpec(routeKey) {
  return OBSERVATION_ROUTES.find((r) => r.route_key === routeKey) || null;
}

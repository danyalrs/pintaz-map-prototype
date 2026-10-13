export const AUDIT_VERSION = 'route-aware-lane-calibration-audit-v1';

export const PREPARED_ROUTE_KEYS = [
  'active',
  'drive-001',
  'drive-005',
  'drive-007',
  'drive-008',
  'drive-010',
];

export const ROUTE_VERDICT = {
  QUALIFIED: 'route_qualified_for_experiment',
  NOT_QUALIFIED: 'route_not_qualified',
  NOT_EVALUABLE: 'route_not_evaluable',
};

export const UNKNOWN_WAY_COVERAGE = {
  NONE: 'no_route_coverage',
  UNQUALIFIED: 'covered_by_unqualified_route',
  NOT_EVALUABLE: 'covered_by_not_evaluable_route',
  QUALIFIED: 'covered_by_qualified_route',
};

/**
 * Provisional minimum-support policy (V1, not production gates).
 * Small samples are reported explicitly; routes below these limits cannot be "qualified".
 */
export const INSUFFICIENT_SAME_ROUTE_LABELLED_SUPPORT = 'insufficient_same_route_labelled_support';

export const MINIMUM_SUPPORT_POLICY = {
  min_eligible_labelled_one_way_ways: 3,
  min_labelled_one_way_ways_any_frames: 1,
  min_quality_accepted_frame_fraction_on_labelled_ways: 0.12,
  disqualify_if_high_margin_incorrect: true,
  description:
    'A route is evaluable only with local preview+poses and ≥3 eligible one-way labelled OSM ways (≥3 matched frames each, same route only). Qualification additionally requires zero high-margin incorrect LOO predictions and ≥12% of frames on labelled ways passing the point-only signature quality gate.',
};

export const DRIVE005_KAMUNING_WAY_ID = '39914067';

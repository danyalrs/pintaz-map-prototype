import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyUnknownLanePair,
  geometryEligibleForUnknownWay,
  aggregateWayShortlistStatuses,
  buildPairShortlistRows,
} from '../src/lib/full-maps-read-route-enrichment-discovery/phase3-shortlist.js';
import { PAIR_SHORTLIST_STATUS } from '../src/lib/full-maps-read-route-enrichment-discovery/phase3-constants.js';
import { ROUTE_VERDICT } from '../src/lib/route-aware-lane-calibration-audit/constants.js';

const goodCoverage = {
  matched_pose_count: 10,
  median_distance_m: 5,
  median_heading_diff_deg: 12,
  direction_compatible_fraction: 0.8,
  continuous_covered_length_m: 40,
};

const qualifiedRoute = {
  route_verdict: ROUTE_VERDICT.QUALIFIED,
  route_fetch_status: 'ok',
  eligible_labelled_ways: 4,
  labelled_ways_on_route: 5,
  disqualification_reasons: [],
};

test('qualified route + good geometry → future_geometry_candidate', () => {
  const c = classifyUnknownLanePair(goodCoverage, qualifiedRoute);
  assert.equal(c.shortlist_status, PAIR_SHORTLIST_STATUS.FUTURE_GEOMETRY);
  assert.equal(c.route_qualified_for_future_geometry, true);
});

test('qualified route + weak geometry → not_geometry_eligible', () => {
  const c = classifyUnknownLanePair({ ...goodCoverage, continuous_covered_length_m: 2 }, qualifiedRoute);
  assert.equal(c.shortlist_status, PAIR_SHORTLIST_STATUS.NOT_GEOMETRY_ELIGIBLE);
});

test('not qualified route → route_not_qualified', () => {
  const c = classifyUnknownLanePair(goodCoverage, {
    route_verdict: ROUTE_VERDICT.NOT_QUALIFIED,
    route_fetch_status: 'ok',
    disqualification_reasons: ['high_margin_incorrect_predictions_1'],
  });
  assert.equal(c.shortlist_status, PAIR_SHORTLIST_STATUS.NOT_QUALIFIED);
});

test('batch pair build tolerates missing route qualification', () => {
  const rows = buildPairShortlistRows(
    [{ route_ref: 'drive-001', osm_way_id: '99', ...goodCoverage, dongle_ref: 'x' }],
    new Map()
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].shortlist_status, PAIR_SHORTLIST_STATUS.QUALIFICATION_PENDING);
  assert.equal(rows[0].selected_lane_count, null);
});

test('way aggregate defaults to qualification_pending', () => {
  const agg = aggregateWayShortlistStatuses([], new Set(['200']));
  assert.equal(agg.ways[0].best_shortlist_status, PAIR_SHORTLIST_STATUS.QUALIFICATION_PENDING);
});

test('way aggregate picks best status across pairs', () => {
  const pairs = [
    {
      osm_way_id: '100',
      shortlist_status: PAIR_SHORTLIST_STATUS.NOT_QUALIFIED,
      shortlist_ranking_score: 0,
    },
    {
      osm_way_id: '100',
      shortlist_status: PAIR_SHORTLIST_STATUS.FUTURE_GEOMETRY,
      shortlist_ranking_score: 10,
    },
  ];
  const agg = aggregateWayShortlistStatuses(pairs, new Set(['100']));
  assert.equal(agg.ways[0].best_shortlist_status, PAIR_SHORTLIST_STATUS.FUTURE_GEOMETRY);
  assert.equal(agg.status_counts[PAIR_SHORTLIST_STATUS.FUTURE_GEOMETRY], 1);
});

test('geometry gate helper', () => {
  assert.equal(geometryEligibleForUnknownWay(goodCoverage), true);
  assert.equal(geometryEligibleForUnknownWay({ matched_pose_count: 1 }), false);
});

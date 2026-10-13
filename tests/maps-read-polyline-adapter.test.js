import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runMapsReadPolylineEndToEnd,
  adaptMapsReadPolylineExport,
  DECISION,
  CONFIDENCE_BAND,
  OUTCOME,
  FIXTURE_CASES,
  REJECTION,
  fixtureServerOsmOverrideTest,
} from '../src/lib/maps-read-polyline-adapter/index.js';

function runFixture(fn) {
  const pair = fn();
  return runMapsReadPolylineEndToEnd(pair.server, pair.context ?? undefined);
}

test('1. A: server export + local OSM context → review candidate', () => {
  const r = runFixture(FIXTURE_CASES.A);
  assert.equal(r.adapter_ok, true);
  assert.equal(r.contract_outcome, OUTCOME.VALID);
  assert.equal(r.selected_lane_count, 1);
  assert.ok(
    [DECISION.SINGLE_FRAME_REVIEW_CANDIDATE, DECISION.MULTI_FRAME_REVIEW_CANDIDATE].includes(
      r.algorithm_decision
    )
  );
});

test('B: three-lane → correct multi-frame candidate', () => {
  const r = runFixture(FIXTURE_CASES.B);
  assert.equal(r.contract_outcome, OUTCOME.VALID);
  assert.equal(r.algorithm_decision, DECISION.MULTI_FRAME_REVIEW_CANDIDATE);
  assert.equal(r.selected_lane_count, 3);
  assert.equal(r.confidence_band, CONFIDENCE_BAND.SUPPORTED_MULTI_FRAME);
});

test('2. missing local OSM context → missing_osm_enrichment_context', () => {
  const { server } = FIXTURE_CASES.A();
  const adapted = adaptMapsReadPolylineExport(server, null);
  assert.equal(adapted.ok, false);
  assert.equal(adapted.rejection, REJECTION.MISSING_OSM_ENRICHMENT_CONTEXT);
  assert.equal(adapted.outcome, 'missing_osm_enrichment_context');
});

test('3. C: point-only → unsupported_point_only', () => {
  const { server } = FIXTURE_CASES.C();
  const adapted = adaptMapsReadPolylineExport(server, null);
  assert.equal(adapted.ok, false);
  assert.equal(adapted.rejection, REJECTION.UNSUPPORTED_POINT_ONLY);
  const r = runMapsReadPolylineEndToEnd(server, null);
  assert.equal(r.contract_outcome, 'unsupported_point_only');
});

test('4. server OSM hint does not override local context', () => {
  const fx = fixtureServerOsmOverrideTest();
  const adapted = adaptMapsReadPolylineExport(fx.server, fx.context);
  assert.equal(adapted.ok, true);
  assert.equal(adapted.ignored_server_osm_hints, true);
  assert.equal(adapted.contract.osm_road.osm_way_id, fx.expected_local_osm_way_id);
  assert.notEqual(adapted.contract.osm_road.osm_way_id, 'server-export-fake-way-999');
});

test('D: invalid polyline unchanged', () => {
  const r = runFixture(FIXTURE_CASES.D);
  assert.equal(r.contract_outcome, OUTCOME.INVALID_POLYLINE);
});

test('E: strong conflict unchanged', () => {
  const r = runFixture(FIXTURE_CASES.E);
  assert.equal(r.contract_outcome, OUTCOME.VALID);
  assert.equal(r.algorithm_decision, DECISION.INSUFFICIENT_EVIDENCE);
  assert.equal(r.note, 'strong_competing_lane_count_hypotheses');
});

test('real route_key disabled at adapter', () => {
  const { server, context } = FIXTURE_CASES.A();
  server.metadata.route_key = 'active';
  const adapted = adaptMapsReadPolylineExport(server, context);
  assert.equal(adapted.ok, false);
  assert.equal(adapted.rejection, REJECTION.REAL_ROUTE_DISABLED);
});

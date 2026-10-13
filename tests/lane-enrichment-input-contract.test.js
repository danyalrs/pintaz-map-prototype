import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateLaneEnrichmentInputContract,
  toAlgorithmCoreBundle,
  OUTCOME,
} from '../src/lib/lane-enrichment-input-contract/index.js';
import { runLaneEnrichmentCore } from '../src/lib/lane-enrichment-algorithm-core/index.js';
import {
  caseA_validOneLane,
  caseB_validThreeLane,
  caseC_mapsReadPointOnly,
  caseD_missingCoordinateFrame,
  caseE_duplicateLineInFrame,
  caseF_invalidProbability,
  caseG_oneVertexLine,
  caseH_twoWay,
  toExampleGeojson,
} from './fixtures/lane-enrichment-input-contract/cases.js';

const results = {};

test('A: valid one-lane bundle', () => {
  const v = validateLaneEnrichmentInputContract(caseA_validOneLane());
  results.A = v.outcome;
  assert.equal(v.outcome, OUTCOME.VALID);
  const mapped = toAlgorithmCoreBundle(caseA_validOneLane());
  assert.equal(mapped.ok, true);
  const core = runLaneEnrichmentCore(mapped.bundle);
  assert.equal(core.selected_lane_count, 1);
});

test('B: valid three-lane bundle', () => {
  const v = validateLaneEnrichmentInputContract(caseB_validThreeLane());
  results.B = v.outcome;
  assert.equal(v.outcome, OUTCOME.VALID);
});

test('C: Maps Read point-only', () => {
  const v = validateLaneEnrichmentInputContract(caseC_mapsReadPointOnly());
  results.C = v.outcome;
  assert.equal(v.outcome, OUTCOME.UNSUPPORTED_POINT_ONLY);
});

test('D: missing coordinate frame', () => {
  const v = validateLaneEnrichmentInputContract(caseD_missingCoordinateFrame());
  results.D = v.outcome;
  assert.equal(v.outcome, OUTCOME.INVALID_COORDINATE_FRAME);
});

test('E: duplicate line in frame', () => {
  const v = validateLaneEnrichmentInputContract(caseE_duplicateLineInFrame());
  results.E = v.outcome;
  assert.equal(v.outcome, OUTCOME.DUPLICATE_LINE_ID_IN_FRAME);
});

test('F: invalid probability', () => {
  const v = validateLaneEnrichmentInputContract(caseF_invalidProbability());
  results.F = v.outcome;
  assert.equal(v.outcome, OUTCOME.INVALID_PROBABILITY);
});

test('G: one-vertex line', () => {
  const v = validateLaneEnrichmentInputContract(caseG_oneVertexLine());
  results.G = v.outcome;
  assert.equal(v.outcome, OUTCOME.INVALID_POLYLINE);
});

test('H: two-way OSM', () => {
  const v = validateLaneEnrichmentInputContract(caseH_twoWay());
  results.H = v.outcome;
  assert.equal(v.outcome, OUTCOME.NOT_ONE_WAY_ELIGIBLE);
});

test('GeoJSON wrapper validates', () => {
  const v = validateLaneEnrichmentInputContract(toExampleGeojson(caseA_validOneLane()));
  assert.equal(v.outcome, OUTCOME.VALID);
});

test('validator never sets lane count', () => {
  const v = validateLaneEnrichmentInputContract(caseB_validThreeLane());
  assert.equal(v.lane_count_inferred, false);
  assert.equal('selected_lane_count' in v, false);
});

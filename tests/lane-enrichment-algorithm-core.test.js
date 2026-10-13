import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runLaneEnrichmentCore,
  validateGeometryInput,
  DECISION,
  CONFIDENCE_BAND,
  SUPPORT_TYPE,
} from '../src/lib/lane-enrichment-algorithm-core/index.js';
import {
  caseA,
  caseB,
  caseC,
  caseD,
  caseE,
  caseF,
  caseG,
  assertCaseFIntersection,
} from './fixtures/lane-enrichment-algorithm-core/cases.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const results = {};

test('A: one-lane one-way', () => {
  const r = runLaneEnrichmentCore(caseA());
  results.A = r;
  assert.equal(r.selected_lane_count, 1);
  assert.ok(
    [DECISION.SINGLE_FRAME_REVIEW_CANDIDATE, DECISION.MULTI_FRAME_REVIEW_CANDIDATE].includes(r.decision)
  );
});

test('B: three-lane one-way', () => {
  const r = runLaneEnrichmentCore(caseB());
  results.B = r;
  assert.equal(r.selected_lane_count, 3);
  assert.equal(r.decision, DECISION.MULTI_FRAME_REVIEW_CANDIDATE);
});

test('C: three-lane with noise', () => {
  const r = runLaneEnrichmentCore(caseC());
  results.C = r;
  assert.ok(r.selected_lane_count === 3 || r.decision === DECISION.INSUFFICIENT_EVIDENCE);
  assert.notEqual(r.selected_lane_count, 4);
  assert.notEqual(r.selected_lane_count, 5);
});

test('D: missing road edge', () => {
  const r = runLaneEnrichmentCore(caseD());
  results.D = r;
  assert.equal(r.decision, DECISION.INSUFFICIENT_EVIDENCE);
});

test('E: point-only input', () => {
  const v = validateGeometryInput(caseE());
  assert.equal(v.unsupported, true);
  const r = runLaneEnrichmentCore(caseE());
  results.E = r;
  assert.equal(r.decision, DECISION.UNSUPPORTED_INPUT_GEOMETRY);
  assert.equal(r.confidence_band, CONFIDENCE_BAND.UNSUPPORTED_INPUT_GEOMETRY);
  assert.equal(r.support_type, SUPPORT_TYPE.NONE);
});

test('F: ambiguous double intersection', () => {
  assert.equal(assertCaseFIntersection(), true);
  const r = runLaneEnrichmentCore(caseF());
  results.F = r;
  assert.ok(r.frame_evidence?.[0]?.rejection_reasons?.some((x) => x.startsWith('ambiguous_multiple_intersections')));
});

test('G: conflicting frames', () => {
  const r = runLaneEnrichmentCore(caseG());
  results.G = r;
  assert.equal(r.decision, DECISION.INSUFFICIENT_EVIDENCE);
  assert.equal(r.note, 'strong_competing_lane_count_hypotheses');
});

test.after(() => {
  const out = path.join(__dirname, '..', 'reports', 'lane_enrichment_algorithm_core_v3', 'synthetic_case_results.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    `${JSON.stringify(
      {
        disclaimer:
          'This validates the future geometry algorithm against controlled synthetic data. It does not validate or infer lane counts from current Maps Read point-only GeoJSON.',
        results: Object.fromEntries(
          Object.entries(results).map(([k, v]) => [
            k,
            {
              decision: v.decision,
              selected_lane_count: v.selected_lane_count,
              decision_score: v.decision_score,
              confidence_band: v.confidence_band,
              support_type: v.support_type,
            },
          ])
        ),
      },
      null,
      2
    )}\n`
  );
});

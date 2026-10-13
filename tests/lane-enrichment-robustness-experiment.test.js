import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScenarioPipeline } from '../src/lib/lane-enrichment-robustness-experiment/run-pipeline.js';
import { runFullExperiment, buildAllScenarios } from '../src/lib/lane-enrichment-robustness-experiment/scenarios.js';
import { DECISION, CONFIDENCE_BAND, SUPPORT_TYPE } from '../src/lib/lane-enrichment-algorithm-core/index.js';
import { OUTCOME } from '../src/lib/lane-enrichment-input-contract/index.js';

test('full experiment: no confident incorrect lane count', () => {
  const { rows, anyIncorrect } = runFullExperiment(runScenarioPipeline);
  assert.equal(anyIncorrect, false, JSON.stringify(rows.filter((r) => r.classification === 'incorrect')));
});

test('scenario A: one clean frame → single_frame_review_candidate (V3.1)', () => {
  for (const n of [1, 2, 3]) {
    const { scenarios } = buildAllScenarios(n);
    const r = runScenarioPipeline(scenarios.A_one_clean_frame, n);
    assert.equal(r.classification, 'correct');
    assert.equal(r.algorithm_decision, DECISION.SINGLE_FRAME_REVIEW_CANDIDATE);
    assert.equal(r.confidence_band, CONFIDENCE_BAND.PROVISIONAL_SINGLE_FRAME);
    assert.equal(r.support_type, SUPPORT_TYPE.SINGLE_FRAME);
    assert.equal(r.selected_lane_count, n);
  }
});

test('scenario B: multi frame review for 1/2/3 lane configs', () => {
  for (const n of [1, 2, 3]) {
    const { scenarios } = buildAllScenarios(n);
    const r = runScenarioPipeline(scenarios.B_three_clean_frames, n);
    assert.equal(r.classification, 'correct');
    assert.equal(r.algorithm_decision, DECISION.MULTI_FRAME_REVIEW_CANDIDATE);
    assert.equal(r.confidence_band, CONFIDENCE_BAND.SUPPORTED_MULTI_FRAME);
    assert.equal(r.support_type, SUPPORT_TYPE.MULTI_FRAME);
  }
});

test('scenario H blocked before core', () => {
  const { scenarios } = buildAllScenarios(3);
  const r = runScenarioPipeline(scenarios.H_point_only, 3);
  assert.equal(r.blocked_before_core, true);
  assert.equal(r.contract_outcome, OUTCOME.UNSUPPORTED_POINT_ONLY);
});

test('scenario F: strong competing groups → insufficient for 1/2/3 lanes', () => {
  for (const n of [1, 2, 3]) {
    const { scenarios } = buildAllScenarios(n);
    const r = runScenarioPipeline(scenarios.F_conflicting_frame_groups, n);
    assert.equal(r.classification, 'insufficient');
    assert.equal(r.note, 'strong_competing_lane_count_hypotheses');
    assert.equal(r.confidence_band, CONFIDENCE_BAND.INSUFFICIENT_OR_CONFLICTING);
    assert.equal(r.support_type, SUPPORT_TYPE.NONE);
  }
});

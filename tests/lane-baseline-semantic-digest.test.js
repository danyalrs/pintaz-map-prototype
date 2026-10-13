import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  laneBaselineSummarySemanticDigest,
  stripVolatileLaneBaselineSummaryFields,
} from '../src/lib/lane-baseline-semantic-digest.js';
import { summaryPath } from '../src/lib/lane-baseline-paths.js';
import { PROTECTED_INPUT_SHA256 } from '../src/lib/multi-drive-mismatch-config.js';
import { verifyProtectedInputHashes } from '../src/lib/multi-drive-rebuild-guard.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadLiveSummary() {
  return JSON.parse(fs.readFileSync(summaryPath(), 'utf8'));
}

test('timestamp change does not alter semantic digest', () => {
  const base = loadLiveSummary();
  const a = laneBaselineSummarySemanticDigest({ ...base, generated_at: '2026-01-01T00:00:00.000Z' });
  const b = laneBaselineSummarySemanticDigest({ ...base, generated_at: '2026-10-02T11:21:24.565Z' });
  assert.equal(a, b);
});

test('key order does not alter semantic digest', () => {
  const base = stripVolatileLaneBaselineSummaryFields(loadLiveSummary());
  const reordered = Object.fromEntries(Object.entries(base).reverse());
  assert.equal(laneBaselineSummarySemanticDigest(base), laneBaselineSummarySemanticDigest(reordered));
});

test('count change alters digest', () => {
  const base = loadLiveSummary();
  const mutated = { ...base, counts: { ...base.counts, osm_roads: base.counts.osm_roads + 1 } };
  assert.notEqual(laneBaselineSummarySemanticDigest(base), laneBaselineSummarySemanticDigest(mutated));
});

test('threshold change alters digest', () => {
  const base = loadLiveSummary();
  const mutated = {
    ...base,
    geometry_gates: { ...base.geometry_gates, area_ratio_max: base.geometry_gates.area_ratio_max + 0.01 },
  };
  assert.notEqual(laneBaselineSummarySemanticDigest(base), laneBaselineSummarySemanticDigest(mutated));
});

test('geometry status change alters digest via rejection reasons', () => {
  const base = loadLiveSummary();
  const mutated = {
    ...base,
    rejection_reasons: { ...base.rejection_reasons, synthetic_gate: 1 },
  };
  assert.notEqual(laneBaselineSummarySemanticDigest(base), laneBaselineSummarySemanticDigest(mutated));
});

test('protected OSM hash still required in summary semantic payload', () => {
  const base = loadLiveSummary();
  assert.equal(base.osm_baseline_hash_sha256, PROTECTED_INPUT_SHA256.bukit_osm);
  const mutated = { ...base, osm_baseline_hash_sha256: '0'.repeat(64) };
  assert.notEqual(laneBaselineSummarySemanticDigest(base), laneBaselineSummarySemanticDigest(mutated));
});

test('guard accepts current valid baseline semantic digest', () => {
  const v = verifyProtectedInputHashes(root);
  assert.equal(v.ok, true, JSON.stringify(v.mismatches));
});

test('guard rejects semantic mutation', () => {
  const base = loadLiveSummary();
  const good = laneBaselineSummarySemanticDigest(base);
  assert.equal(good, PROTECTED_INPUT_SHA256.lane_baseline_summary);
  const bad = laneBaselineSummarySemanticDigest({
    ...base,
    counts: { ...base.counts, dividers_generated: base.counts.dividers_generated - 1 },
  });
  assert.notEqual(bad, PROTECTED_INPUT_SHA256.lane_baseline_summary);
});

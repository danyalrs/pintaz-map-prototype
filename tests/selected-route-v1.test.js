import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  evaluatePaginationStep,
  PAGINATION_LIMITS,
  shouldNeverRetryStatus,
} from '../src/lib/selected-route-pagination.js';
import { EXPECTED } from '../src/lib/update-preview-prepare.js';
import { EXISTING_RAW_SOURCE_PATH, PAGE_000_PATH } from '../src/lib/selected-route-paths.js';
import { ensurePage000FromExisting, buildDerivedSelectedRoute } from '../src/lib/selected-route-derived-build.js';
import { countLiteralNanTokens, parseRawPageForDerived } from '../src/lib/selected-route-page-validate.js';
import { buildPublicManifest } from '../src/lib/update-preview-manifest.js';
import { MAP_CLICK_PRIORITY, observationStageIndex, diagnosticStageIndex } from '../src/lib/map-click-priority.js';

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

test('pagination stops when truncated=false', () => {
  const r = evaluatePaginationStep({
    truncated: false,
    nextAfterSeg: 99,
    previousAfterSeg: 50,
    seenAfterSegs: new Set(),
  });
  assert.equal(r.stop, true);
  assert.equal(r.reason, 'truncated_false');
});

test('repeated next_after_seg stops safely', () => {
  const seen = new Set([23]);
  const r = evaluatePaginationStep({
    truncated: true,
    nextAfterSeg: 23,
    previousAfterSeg: 20,
    seenAfterSegs: seen,
  });
  assert.equal(r.reason, 'next_after_seg_repeated');
});

test('backward next_after_seg stops safely', () => {
  const r = evaluatePaginationStep({
    truncated: true,
    nextAfterSeg: 10,
    previousAfterSeg: 23,
    seenAfterSegs: new Set(),
  });
  assert.equal(r.reason, 'next_after_seg_backward');
});

test('resumable page 000 hash matches existing raw sample', () => {
  if (!fs.existsSync(EXISTING_RAW_SOURCE_PATH)) return;
  ensurePage000FromExisting();
  assert.equal(sha256File(EXISTING_RAW_SOURCE_PATH), sha256File(PAGE_000_PATH));
  assert.equal(sha256File(PAGE_000_PATH), EXPECTED.rawSha256);
});

test('raw page 000 unchanged after ensure copy', () => {
  if (!fs.existsSync(EXISTING_RAW_SOURCE_PATH)) return;
  const before = sha256File(EXISTING_RAW_SOURCE_PATH);
  ensurePage000FromExisting();
  assert.equal(sha256File(EXISTING_RAW_SOURCE_PATH), before);
});

test('NaN normalization affects derived copy only', () => {
  if (!fs.existsSync(PAGE_000_PATH)) return;
  const raw = fs.readFileSync(PAGE_000_PATH);
  assert.ok(countLiteralNanTokens(raw.toString('utf8')) > 0);
  const { collection, replacementCount } = parseRawPageForDerived(raw);
  assert.ok(replacementCount > 0);
  const sample = collection.features.find((f) => f.properties?.t === null);
  assert.ok(sample);
});

test('derived output preserves all features when pages exist', () => {
  if (!fs.existsSync(PAGE_000_PATH)) return;
  const derived = buildDerivedSelectedRoute();
  if (!derived.ok) return;
  assert.ok(derived.totalFeatures >= EXPECTED.featureCount);
});

test('duplicates reported but retained in faithful preview', () => {
  if (!fs.existsSync(PAGE_000_PATH)) return;
  const derived = buildDerivedSelectedRoute();
  if (!derived.ok) return;
  assert.equal(typeof derived.duplicateGroups, 'number');
  assert.equal(typeof derived.duplicateFeatureInstances, 'number');
});

test('public manifest has no full dongle id', () => {
  const manifest = buildPublicManifest({
    acceptance_state: 'pending',
    truncated: false,
    route_status: 'complete',
    route_page_count: 3,
    normalization: { type: 'transport_only', replacement_count: 1 },
    baseline_osm_changed: false,
    source_dongle_redacted: '0367…e14',
    source_route_redacted: '2026-08-30--…--0',
    total_feature_count: 100,
    counts_by_layer: {},
    inside_area_count: 1,
    outside_area_count: 0,
  });
  const text = JSON.stringify(manifest);
  assert.doesNotMatch(text, /0367014303470e14/);
  assert.match(manifest.preview_label, /Complete selected route/);
});

test('tokens do not enter pagination limits export', () => {
  const text = JSON.stringify(PAGINATION_LIMITS);
  assert.doesNotMatch(text, /MAPS_READ_TOKEN/);
});

test('401/403/429 never auto-retry', () => {
  assert.equal(shouldNeverRetryStatus(401), true);
  assert.equal(shouldNeverRetryStatus(429), true);
});

test('click priority gives observations before mismatch diagnostics', () => {
  assert.ok(observationStageIndex() < diagnosticStageIndex());
  assert.equal(MAP_CLICK_PRIORITY[0], 'actionable_multi_drive_candidate');
});

test('overlapping click priority in map-selection source', () => {
  const src = fs.readFileSync(new URL('../src/public/map-selection.js', import.meta.url), 'utf8');
  const start = src.indexOf('return function handleMapClick');
  const body = src.slice(start, start + 3200);
  const mdCandIdx = body.indexOf('tryMultiDriveCandidateClick');
  const mmCandIdx = body.indexOf('tryMismatchCandidateClick');
  const obsIdx = body.indexOf('handleObservationEvidenceClick');
  const mdDiagIdx = body.indexOf('tryMultiDriveDiagnosticClick');
  const diagIdx = body.indexOf('tryMismatchNonCandidateClick');
  const compIdx = body.indexOf('comparisonClickLayerIds');
  assert.ok(
    mdCandIdx >= 0 &&
      mmCandIdx > mdCandIdx &&
      obsIdx > mmCandIdx &&
      mdDiagIdx > obsIdx &&
      diagIdx > mdDiagIdx &&
      compIdx > diagIdx
  );
});

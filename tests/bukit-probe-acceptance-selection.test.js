import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyFailedDownload,
  classifyRouteCompleteness,
} from '../src/lib/bukit-probe-route-completeness.js';
import { buildRedactedDongleGroups } from '../src/lib/bukit-probe-dongle-groups.js';
import { jaccardSimilarity, marginalNewCells, pairwiseOverlapReport } from '../src/lib/bukit-probe-spatial-grid.js';
import { greedyMarginalCoverageSelection } from '../src/lib/bukit-probe-greedy-selection.js';
import { containsFullDongle } from '../src/lib/bukit-route-redaction.js';
import { liveCompleteRouteSnapshot } from './helpers/isolated-maps-read-fixture.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const RAW_HASHES = {
  'drive-001': '33bf15444f77a0ddc679c5e94d335faa9c19e42e62bdcd37d568328eea8e97bb',
  'drive-005': 'a2e0af95818cfa55f3e7815cb4f9042422e7f87ba537260b429c9ef79334d887',
  'drive-007': '6c8a932ca97f6b79a522d28eee5cd24691382f56ea336a53435886fb3ebb886b',
  'drive-008': '0548713bc388237627d1d5edf4e5cb767692d65b62dff12378c3e54697fbb42e',
  'drive-010': 'bceb902f8acbb9c6b68317ca3ec4b878859a648002632c827a9e15c49f948d00',
};

test('truncated:false becomes complete_single_response_route', () => {
  assert.equal(
    classifyRouteCompleteness({ truncated: false, next_after_seg: null }),
    'complete_single_response_route'
  );
});

test('oversized remains unmeasured', () => {
  assert.equal(classifyFailedDownload('response_too_large'), 'unmeasured_response_too_large');
});

test('stable redacted dongle groups', () => {
  const entries = [
    { probe_ref: 'drive-001', dongle: 'aaaaaaaaaaaaaaaa', route: '2026-01-01--01-01-01' },
    { probe_ref: 'drive-002', dongle: 'bbbbbbbbbbbbbbbb', route: '2026-01-02--01-01-01' },
    { probe_ref: 'drive-003', dongle: 'aaaaaaaaaaaaaaaa', route: '2026-01-03--01-01-01' },
  ];
  const a = buildRedactedDongleGroups(entries);
  const b = buildRedactedDongleGroups(entries);
  assert.deepEqual(a.groups, b.groups);
  assert.equal(a.routes.filter((r) => r.dongle_group === 'dongle-group-A').length, 2);
});

test('jaccard and pairwise overlap', () => {
  const a = new Set(['1,1', '1,2']);
  const b = new Set(['1,2', '2,2']);
  assert.equal(jaccardSimilarity(a, b), 1 / 3);
  const map = new Map([
    ['drive-001', a],
    ['drive-002', b],
  ]);
  const pairs = pairwiseOverlapReport(map);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].shared_cells, 1);
});

test('greedy marginal coverage and dongle cap', () => {
  const routeCellsByRef = new Map([
    ['drive-001', new Set(['a', 'b'])],
    ['drive-002', new Set(['c', 'd', 'e'])],
    ['drive-003', new Set(['f'])],
  ]);
  const candidates = [
    { probe_ref: 'drive-001', dongle_group: 'dongle-group-A', route_date_key: '2026-01-01' },
    { probe_ref: 'drive-002', dongle_group: 'dongle-group-A', route_date_key: '2026-01-02' },
    { probe_ref: 'drive-003', dongle_group: 'dongle-group-B', route_date_key: '2026-01-03' },
  ];
  const supportByRef = new Map();
  const r = greedyMarginalCoverageSelection({
    candidates,
    initialCoveredCells: new Set(['b']),
    routeCellsByRef,
    supportByRef,
    maxRoutes: 3,
    maxPerDongleGroup: 2,
  });
  assert.equal(r.selected[0], 'drive-002');
  assert.ok(r.selected.length <= 3);
  assert.ok((r.perGroup.get('dongle-group-A') || 0) <= 2);
});

test('marginal new cells helper', () => {
  const cells = new Set(['a', 'b']);
  const covered = new Set(['b', 'c']);
  assert.equal(marginalNewCells(cells, covered), 1);
});

test('corrected selection report exists without dongle leak', () => {
  const p = path.join(root, 'reports', 'bukit_route_page1_probe_v1', 'corrected_selection.redacted.json');
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, 'utf8');
  assert.equal(containsFullDongle(text), false);
  const doc = JSON.parse(text);
  assert.ok(doc.selected_routes.length <= 3);
});

test('drive-008 rule documented in corrected selection', () => {
  const p = path.join(root, 'reports', 'bukit_route_page1_probe_v1', 'corrected_selection.redacted.json');
  if (!fs.existsSync(p)) return;
  const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.ok(doc.drive_008?.rule_explanation);
});

test('raw candidate hashes unchanged', () => {
  const rawDir = path.join(root, 'data', 'maps-read', 'bukit-route-page1-probe-v1', 'private', 'raw');
  for (const [ref, expected] of Object.entries(RAW_HASHES)) {
    const file = path.join(rawDir, `${ref}-page-1.geojson`);
    if (!fs.existsSync(file)) continue;
    const h = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(h, expected);
  }
});

test('active-source preview hash unchanged', () => {
  const snap = liveCompleteRouteSnapshot();
  if (!snap) return;
  assert.equal(snap.previewSha256, '1f1d223cf45687c777b8fb5f32108392791525eec16ee0dec3f93ce0f125d444');
});

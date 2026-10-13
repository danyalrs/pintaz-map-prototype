import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateRoutesOffsetStep,
  ROUTES_LIST_LIMITS,
} from '../src/lib/routes-list-pagination.js';
import {
  buildDriveReferenceMap,
  containsFullDongle,
  routeSortKey,
} from '../src/lib/bukit-route-redaction.js';
import { mergeInventoryFromPages, validatePaginationContinuity } from '../src/lib/bukit-route-inventory.js';
import { buildDeterministicShortlist } from '../src/lib/bukit-route-shortlist-build.js';
import { ROUTES_API_SEMANTICS } from '../src/lib/bukit-route-api-semantics.js';
import { liveCompleteRouteSnapshot } from './helpers/isolated-maps-read-fixture.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('routes pagination completes when next_offset absent', () => {
  const r = evaluateRoutesOffsetStep({
    returned: 5,
    nextOffset: null,
    previousOffset: 0,
    seenOffsets: new Set([0]),
  });
  assert.equal(r.reason, 'next_offset_absent');
});

test('repeated offset rejected', () => {
  const seen = new Set([0, 500]);
  const r = evaluateRoutesOffsetStep({
    returned: 100,
    nextOffset: 500,
    previousOffset: 400,
    seenOffsets: seen,
  });
  assert.equal(r.reason, 'next_offset_repeated');
});

test('duplicate route detection in inventory merge', () => {
  const page = {
    file_name: 'p.json',
    page_number: 0,
  };
  const buf = Buffer.from(
    JSON.stringify({
      offset: 0,
      returned: 2,
      next_offset: null,
      routes: [
        {
          dongle: '0367014303470e14',
          route: '2026-08-30--07-33-21',
          version: '0.8.13',
          segments: 1,
          model_frames: 1,
          gps_fixes: 1,
        },
        {
          dongle: '0367014303470e14',
          route: '2026-08-30--07-33-21',
          version: '0.8.13',
          segments: 1,
          model_frames: 2,
          gps_fixes: 2,
        },
      ],
    })
  );
  const merged = mergeInventoryFromPages([page], () => buf);
  assert.equal(merged.record_count, 1);
  assert.equal(merged.duplicate_pair_count, 1);
});

test('deterministic redaction drive refs', () => {
  const records = [
    {
      dongle: 'aaaaaaaaaaaaaaaa',
      route: '2026-01-01--01-01-01',
      version: '0',
      segments: 1,
      model_frames: 1,
      gps_fixes: 1,
    },
    {
      dongle: 'bbbbbbbbbbbbbbbb',
      route: '2026-01-02--01-01-01',
      version: '0',
      segments: 1,
      model_frames: 2,
      gps_fixes: 2,
    },
  ];
  const map = buildDriveReferenceMap(records);
  assert.equal(map.get(routeSortKey(records[0])), 'drive-001');
  assert.equal(map.get(routeSortKey(records[1])), 'drive-002');
});

test('shortlist max two per dongle and excludes active route', () => {
  const records = [];
  for (let i = 0; i < 8; i += 1) {
    records.push({
      dongle: '0367014303470e14',
      route: `2026-08-${String(i + 1).padStart(2, '0')}--01-01-01`,
      version: '0.8.13',
      segments: 1,
      model_frames: 100 - i,
      gps_fixes: 10,
    });
  }
  records.push({
    dongle: '03e47e3a523a8f96',
    route: '2026-08-30--07-33-21',
    version: '0.8.13',
    segments: 1,
    model_frames: 500,
    gps_fixes: 50,
  });
  const activeKey = routeSortKey({
    dongle: '03e47e3a523a8f96',
    route: '2026-08-30--07-33-21',
  });
  const { private: priv, redacted } = buildDeterministicShortlist(records, { activeKey, maxRoutes: 10 });
  assert.ok(priv.routes.length <= 10);
  const per = new Map();
  for (const r of priv.routes) {
    per.set(r.dongle, (per.get(r.dongle) || 0) + 1);
  }
  for (const c of per.values()) assert.ok(c <= 2);
  assert.ok(!priv.routes.some((r) => r.dongle === '03e47e3a523a8f96' && r.route === '2026-08-30--07-33-21'));
  assert.ok(!JSON.stringify(redacted).includes('03e47e3a523a8f96'));
});

test('deterministic shortlist ordering stable', () => {
  const records = [
    {
      dongle: 'aaaaaaaaaaaaaaaa',
      route: '2026-08-01--01-01-01',
      version: '0',
      segments: 1,
      model_frames: 50,
      gps_fixes: 5,
    },
    {
      dongle: 'bbbbbbbbbbbbbbbb',
      route: '2026-08-02--01-01-01',
      version: '0',
      segments: 1,
      model_frames: 40,
      gps_fixes: 5,
    },
  ];
  const a = buildDeterministicShortlist(records, { activeKey: null }).redacted.routes.map((r) => r.drive_ref);
  const b = buildDeterministicShortlist(records, { activeKey: null }).redacted.routes.map((r) => r.drive_ref);
  assert.deepEqual(a, b);
});

test('count semantics documented as unknown for per-route fields', () => {
  assert.equal(ROUTES_API_SEMANTICS.per_route_model_frames_scope, 'unknown');
  assert.equal(ROUTES_API_SEMANTICS.per_route_gps_fixes_scope, 'unknown');
});

test('pagination continuity validation', () => {
  const issues = validatePaginationContinuity([
    { offset: 0, next_offset: 500 },
    { offset: 500, next_offset: null },
  ]);
  assert.equal(issues.length, 0);
});

test('reports must not contain bearer patterns', () => {
  const reportDir = path.join(root, 'reports', 'bukit_route_shortlist_v1');
  if (!fs.existsSync(reportDir)) return;
  for (const name of fs.readdirSync(reportDir)) {
    const text = fs.readFileSync(path.join(reportDir, name), 'utf8');
    assert.doesNotMatch(text, /MAPS_READ_TOKEN/);
    assert.doesNotMatch(text, /Authorization:\s*Bearer/i);
    assert.equal(containsFullDongle(text), false);
  }
});

test('redacted shortlist has no full dongle ids', () => {
  const p = path.join(root, 'reports', 'bukit_route_shortlist_v1', 'shortlist.redacted.json');
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, 'utf8');
  assert.equal(containsFullDongle(text), false);
  const doc = JSON.parse(text);
  for (const r of doc.routes || []) {
    assert.match(r.drive_ref, /^drive-\d{3,}$/);
    assert.equal(r.existing_active_route, 'no');
  }
});

test('active-source manifest and preview hashes unchanged', () => {
  const snap = liveCompleteRouteSnapshot();
  if (!snap || snap.route_status !== 'complete') return;
  assert.equal(snap.total_features, 8706);
  assert.equal(snap.previewSha256, '1f1d223cf45687c777b8fb5f32108392791525eec16ee0dec3f93ce0f125d444');
  assert.equal(snap.envelopeSha256, '63a265da31af14a7a507ce29463dfd359338c6779288bd32f40443c61396a6bf');
  const manifest = JSON.parse(fs.readFileSync(snap.manifestPath, 'utf8'));
  assert.equal(manifest.source_type, 'complete_selected_route');
  assert.equal(manifest.total_features, 8706);
});

test('routes list safety limits documented', () => {
  assert.equal(ROUTES_LIST_LIMITS.maxRecords, 2500);
  assert.equal(ROUTES_LIST_LIMITS.maxPages, 100);
});

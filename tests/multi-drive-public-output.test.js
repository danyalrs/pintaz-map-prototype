import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  assertPublicOutputSafe,
  assertPublicGeoJsonSafe,
  redactPerDriveSection,
  isSingleDriveConsistentSection,
} from '../src/lib/multi-drive-redact.js';
import { redactedDongleAuditForReports } from '../src/lib/multi-drive-dongle-audit.js';
import { aggregateSummaryRedactedPath, aggregateSectionsRedactedPath } from '../src/lib/multi-drive-mismatch-paths.js';
import { registerMultiDriveMismatchRoutes } from '../src/lib/multi-drive-routes.js';
import express from 'express';

test('assertPublicOutputSafe rejects full dongle id', () => {
  assert.throws(() => assertPublicOutputSafe({ note: 'dongle f449c322f59e6943' }), /full_dongle/);
});

test('assertPublicOutputSafe rejects 12-char dongle fingerprint field', () => {
  assert.throws(
    () => assertPublicOutputSafe({ dongle_fingerprint: 'a1b2c3d4e5f6' }),
    /dongle_fingerprint/
  );
});

test('assertPublicOutputSafe rejects Authorization bearer', () => {
  assert.throws(
    () => assertPublicOutputSafe({ hdr: 'Authorization: Bearer secret-token-xyz' }),
    /authorization|bearer/i
  );
});

test('assertPublicOutputSafe rejects bearer token string', () => {
  assert.throws(() => assertPublicOutputSafe({ x: 'Bearer eyJhbGciOiJIUzI1NiJ9' }), /bearer/i);
});

test('redacted dongle audit exposes groups only', () => {
  const auditInput = {
    distinct_real_dongles: 2,
    groups: [
      { dongle_group: 'dongle-group-A', drive_keys: ['drive-001', 'drive-002'] },
      { dongle_group: 'dongle-group-B', drive_keys: ['drive-005'] },
    ],
    drives: [
      { drive_key: 'drive-001', redacted_drive_ref: 'probe-001', dongle_group: 'dongle-group-A' },
      { drive_key: 'drive-002', redacted_drive_ref: 'probe-002', dongle_group: 'dongle-group-A' },
      { drive_key: 'drive-005', redacted_drive_ref: 'probe-005', dongle_group: 'dongle-group-B' },
    ],
  };
  const audit = redactedDongleAuditForReports(auditInput);
  assertPublicOutputSafe(audit);
  assert.ok(audit.groups.every((g) => !('dongle_fingerprint' in g)));
});

test('per-drive redacted section has no fingerprint fields', () => {
  const row = redactPerDriveSection(
    { redacted_drive_ref: 'probe-001', dongle_group: 'dongle-group-A' },
    {
      section: {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [101.71, 3.147] },
        properties: { osm_id: '1', classification: 'not_evaluated', vehicle_frames: 1 },
      },
      along_start_m: 0,
      along_end_m: 10,
    }
  );
  assertPublicOutputSafe(row);
});

test('single-drive consistent detector requires one centreline support drive', () => {
  const props = {
    mismatch_class: 'consistent_with_osm_lanes',
    per_drive_evidence: [
      {
        redacted_drive_ref: 'probe-001',
        dongle_group: 'dongle-group-D',
        classification: 'consistent_with_osm_lanes',
        support_eligible_centreline: true,
      },
    ],
  };
  assert.equal(isSingleDriveConsistentSection(props), true);
});

test('aggregate sections geojson passes scoped public scan when present', () => {
  const p = aggregateSectionsRedactedPath();
  if (!fs.existsSync(p)) return;
  assertPublicGeoJsonSafe(JSON.parse(fs.readFileSync(p, 'utf8')));
});

test('built aggregate summary passes public scan when present', () => {
  const p = aggregateSummaryRedactedPath();
  if (!fs.existsSync(p)) return;
  assertPublicOutputSafe(JSON.parse(fs.readFileSync(p, 'utf8')));
});

test('summary API response passes public scan when built', async () => {
  const p = aggregateSummaryRedactedPath();
  if (!fs.existsSync(p)) return;
  const app = express();
  registerMultiDriveMismatchRoutes(app);
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/multi-drive-mismatch/v1/bukit-bintang-imbi/summary`);
    const body = await res.text();
    assertPublicOutputSafe(JSON.parse(body));
  } finally {
    server.close();
  }
});

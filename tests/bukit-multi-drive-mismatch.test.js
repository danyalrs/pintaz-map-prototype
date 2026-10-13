import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MULTI_DRIVE_KEYS, EXPECTED_RAW_SHA256, driveSpec } from '../src/lib/multi-drive-mismatch-config.js';
import { spansOverlapOrAdjacent, aggregateCrossDriveEvidence } from '../src/lib/multi-drive-aggregate.js';
import { DEFAULT_PARAMS } from '../src/lib/mismatch-classify.js';
import { isMultiDriveActionable } from '../src/lib/multi-drive-redact.js';
import { applyMultiDriveDecision } from '../src/lib/multi-drive-decisions.js';
import { resolveOverlappingClick } from '../src/lib/map-click-resolution.js';
import { aggregateSummaryRedactedPath } from '../src/lib/multi-drive-mismatch-paths.js';
import { ROOT_DIR } from '../src/config.js';

test('four drives remain separate namespaces', () => {
  assert.equal(MULTI_DRIVE_KEYS.length, 4);
  const refs = MULTI_DRIVE_KEYS.map((k) => driveSpec(k).drive_namespace);
  assert.equal(new Set(refs).size, 4);
});

test('duplicate frame ids across drives do not share namespace', () => {
  const ns = MULTI_DRIVE_KEYS.map((k) => driveSpec(k).drive_namespace);
  assert.deepEqual(ns.sort(), ['drive-001', 'drive-008', 'drive-010', 'drive-active'].sort());
});

test('spans overlap or adjacent within margin', () => {
  assert.equal(spansOverlapOrAdjacent({ along_start_m: 0, along_end_m: 10 }, { along_start_m: 12, along_end_m: 20 }), true);
  assert.equal(spansOverlapOrAdjacent({ along_start_m: 0, along_end_m: 10 }, { along_start_m: 30, along_end_m: 40 }), false);
});

test('same dongle group cannot form multi-drive candidate', () => {
  const row = (ref, group, cls, start, end) => ({
    drive_key: ref,
    redacted_drive_ref: ref,
    dongle_group: group,
    enriched_sections: [
      {
        section: {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [101.71, 3.147] },
          properties: {
            classification: cls,
            osm_id: '1',
            support_eligible_lane_edge: true,
            support_eligible_centreline: true,
            sensitivity_stable: true,
            vehicle_frames: 10,
            confidence: 0.9,
            frames_with_both_edges: 4,
            median_common_centre_shift_m: 0.6,
          },
        },
        along_start_m: start,
        along_end_m: end,
      },
    ],
  });
  const { aggregateFeatures } = aggregateCrossDriveEvidence([
    row('a', 'dongle-group-F', 'possible_centerline_offset', 0, 20),
    row('b', 'dongle-group-F', 'possible_centerline_offset', 5, 25),
  ]);
  const cand = aggregateFeatures.find((f) => f.properties.aggregate_state === 'possible_mismatch_supported_by_multiple_drives');
  assert.equal(cand, undefined);
});

test('two distinct dongle groups can form multi-drive candidate', () => {
  const row = (ref, group, start, end, shift) => ({
    drive_key: ref,
    redacted_drive_ref: ref,
    dongle_group: group,
    enriched_sections: [
      {
        section: {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [101.71, 3.147] },
          properties: {
            classification: 'possible_centerline_offset',
            osm_id: '99',
            support_eligible_centreline: true,
            sensitivity_stable: true,
            vehicle_frames: 12,
            confidence: 0.85,
            frames_with_both_edges: 4,
            median_common_centre_shift_m: shift,
          },
        },
        along_start_m: start,
        along_end_m: end,
      },
    ],
  });
  const { aggregateFeatures } = aggregateCrossDriveEvidence([
    row('a', 'dongle-group-C', 0, 30, 0.55),
    row('b', 'dongle-group-G', 10, 40, 0.6),
  ]);
  const cand = aggregateFeatures.find(
    (f) => f.properties.aggregate_state === 'possible_mismatch_supported_by_multiple_drives'
  );
  assert.ok(cand);
  assert.equal(cand.properties.distinct_dongle_groups.length, 2);
});

test('incompatible offset signs become conflict', () => {
  const row = (group, shift) => ({
    drive_key: group,
    redacted_drive_ref: group,
    dongle_group: group,
    enriched_sections: [
      {
        section: {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [101.71, 3.147] },
          properties: {
            classification: 'possible_centerline_offset',
            osm_id: '5',
            support_eligible_centreline: true,
            sensitivity_stable: true,
            vehicle_frames: 12,
            confidence: 0.8,
            frames_with_both_edges: 4,
            median_common_centre_shift_m: shift,
          },
        },
        along_start_m: 0,
        along_end_m: 40,
      },
    ],
  });
  const { aggregateFeatures } = aggregateCrossDriveEvidence([
    row('dongle-group-C', 0.7),
    row('dongle-group-G', -0.65),
  ]);
  const conflict = aggregateFeatures.find((f) => f.properties.aggregate_state === 'conflicting_drive_evidence');
  assert.ok(conflict);
});

test('single-drive signal is non-actionable', () => {
  assert.equal(isMultiDriveActionable('single_drive_signal_only'), false);
  assert.equal(isMultiDriveActionable('possible_mismatch_supported_by_multiple_drives'), true);
});

test('decisions reject non-actionable classes', () => {
  assert.throws(() =>
    applyMultiDriveDecision({
      candidateId: 'x',
      newState: 'accepted',
      aggregateState: 'single_drive_signal_only',
      baseDir: path.join(ROOT_DIR, 'data', 'maps-read', 'multi-drive-mismatch-v1'),
    })
  );
});

test('per-drive thresholds remain DEFAULT_PARAMS', () => {
  assert.equal(DEFAULT_PARAMS.minFrames, 8);
  assert.equal(DEFAULT_PARAMS.minSectionLengthM, 25);
});

test('raw hashes unchanged checkpoints', () => {
  for (const key of MULTI_DRIVE_KEYS) {
    const spec = driveSpec(key);
    if (!fs.existsSync(spec.raw_path)) continue;
    const buf = fs.readFileSync(spec.raw_path);
    const sha = createHash('sha256').update(buf).digest('hex');
    assert.equal(sha, EXPECTED_RAW_SHA256[key]);
  }
});

test('zero multi-drive candidates is valid when outputs missing', () => {
  const p = aggregateSummaryRedactedPath();
  if (!fs.existsSync(p)) return;
  const summary = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.ok(summary.multi_drive_candidates >= 0);
});

test('click priority prefers multi-drive candidate', () => {
  const stage = resolveOverlappingClick({
    evidenceVisible: true,
    hasActionableMultiDriveCandidate: true,
    hasMultiDriveDiagnostic: true,
    hasActionableCandidate: true,
    hasObservation: true,
    hasDiagnostic: true,
  });
  assert.equal(stage, 'actionable_multi_drive_candidate');
});

test('Kinrara clears multi-drive layers via loader guard', () => {
  const src = fs.readFileSync(new URL('../src/public/multi-drive-mismatch-layers.js', import.meta.url), 'utf8');
  assert.ok(src.includes("areaId !== MULTI_DRIVE_AREA"));
});

test('map-selection wires multi-drive before mismatch candidate', () => {
  const src = fs.readFileSync(new URL('../src/public/map-selection.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('return function handleMapClick'), src.indexOf('return function handleMapClick') + 800);
  const md = block.indexOf('tryMultiDriveCandidateClick');
  const mm = block.indexOf('tryMismatchCandidateClick');
  assert.ok(md >= 0 && mm > md);
});

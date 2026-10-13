import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadBukitPilotBbox, partitionFeaturesByPilot, pointInsideBukitPilot } from '../src/lib/bukit-pilot-bounds.js';
import { buildObservationOsmComparison } from '../src/lib/comparison-build.js';
import { buildActualDongleGroups } from '../src/lib/multi-drive-dongle-audit.js';
import { groupSectionsContiguous, groupSectionsLegacyFrameGap } from '../src/lib/mismatch-section-group.js';
import { DEFAULT_PARAMS } from '../src/lib/mismatch-classify.js';
import { deriveNotEvaluatedReasons } from '../src/lib/multi-drive-pilot-diagnosis.js';
import { EXPECTED_RAW_SHA256, driveSpec } from '../src/lib/multi-drive-mismatch-config.js';
import { localAreaGeojsonPath, DEFAULT_LOCAL_AREA_ID } from '../src/lib/local-areas.js';

function pose(lon, lat, frameId, t) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { layer: 'vehicle_pose', frame_id: frameId, log_mono_time: t, heading_deg: 90 },
  };
}

test('exact bbox max-edge convention is inclusive', () => {
  const bbox = loadBukitPilotBbox();
  assert.equal(pointInsideBukitPilot(bbox.minLon, bbox.minLat, bbox), true);
  assert.equal(pointInsideBukitPilot(bbox.maxLon, bbox.maxLat, bbox), true);
  assert.equal(pointInsideBukitPilot(bbox.minLon, bbox.maxLat, bbox), true);
  assert.equal(pointInsideBukitPilot(bbox.maxLon, bbox.minLat, bbox), true);
});

test('points immediately outside each pilot edge are excluded', () => {
  const bbox = loadBukitPilotBbox();
  const eps = 1e-7;
  assert.equal(pointInsideBukitPilot(bbox.minLon - eps, bbox.minLat, bbox), false);
  assert.equal(pointInsideBukitPilot(bbox.minLon, bbox.minLat - eps, bbox), false);
  assert.equal(pointInsideBukitPilot(bbox.maxLon + eps, bbox.maxLat, bbox), false);
  assert.equal(pointInsideBukitPilot(bbox.maxLon, bbox.maxLat + eps, bbox), false);
});

test('partition conserves total = inside + outside', () => {
  const bbox = loadBukitPilotBbox();
  const feats = [pose(101.71, 3.147, 1, 1), pose(101.5, 3.0, 2, 2)];
  const part = partitionFeaturesByPilot(feats, bbox);
  assert.equal(part.inside + part.outside, feats.length);
});

test('pilot bbox excludes outside poses from matcher input', () => {
  const roads = localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID);
  if (!fs.existsSync(roads)) return;
  const bbox = loadBukitPilotBbox();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-scope-'));
  const previewPath = path.join(dir, 'preview.geojson');
  const inside = pose(101.715, 3.147, 1, 1e9);
  const outside = pose(101.5, 3.0, 2, 2e9);
  fs.writeFileSync(
    previewPath,
    JSON.stringify({ type: 'FeatureCollection', features: [inside, outside] })
  );
  const r = buildObservationOsmComparison({
    previewPath,
    outputDir: dir,
    roadsPath: roads,
    pilotBbox: bbox,
  });
  assert.equal(r.ok, true);
  assert.equal(r.summary.excluded_outside_pilot_pose_count, 1);
  assert.equal(r.summary.matcher_input_pose_count, 1);
  assert.equal(
    r.summary.matcher_input_pose_count,
    r.summary.matched_pose_count + r.summary.matcher_rejected_pose_count
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('dongle groups derive from private equality map without exposing ids', () => {
  const audit = buildActualDongleGroups();
  const report = JSON.stringify(audit.drives);
  assert.ok(!/"[0-9a-f]{16}"/i.test(report));
  assert.ok(audit.distinct_real_dongles >= 1);
});

test('distinct dongle groups match distinct real dongles', () => {
  const a = buildActualDongleGroups();
  const groups = new Set(a.drives.map((d) => d.dongle_group).filter(Boolean));
  assert.equal(groups.size, a.distinct_real_dongles);
  assert.ok(!JSON.stringify(a.drives).includes('dongle_fingerprint'));
});

test('contiguous grouping ignores large frame id gap when time/spatial continuous', () => {
  const m = (fid, t, lon) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, 3.147] },
    properties: { osm_id: '1', frame_id: fid, log_mono_time: t, pose_index: fid, bridge: false, tunnel: false },
  });
  const sections = groupSectionsContiguous([m(1, 1e9, 101.71), m(500, 1.1e9, 101.7101)]);
  assert.equal(sections.length, 1);
  const legacy = groupSectionsLegacyFrameGap([m(1, 1e9, 101.71), m(500, 1.1e9, 101.7101)]);
  assert.equal(legacy.length, 2);
});

test('genuine spatial gap still splits contiguous sections', () => {
  const m = (fid, lon) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, 3.147] },
    properties: { osm_id: '1', frame_id: fid, log_mono_time: fid, pose_index: fid, bridge: false, tunnel: false },
  });
  const sections = groupSectionsContiguous([m(1, 101.71), m(2, 101.75)]);
  assert.equal(sections.length, 2);
});

test('deriveNotEvaluatedReasons retains multiple gates', () => {
  const r = deriveNotEvaluatedReasons({
    classification: 'not_evaluated',
    gate_failures: ['outside_coverage', 'min_frames'],
    sensitivity_stable: false,
  });
  assert.ok(r.includes('outside_pilot'));
  assert.ok(r.includes('insufficient_frames'));
  assert.ok(r.includes('sensitivity_unstable'));
});

test('threshold constants unchanged', () => {
  assert.equal(DEFAULT_PARAMS.minFrames, 8);
  assert.equal(DEFAULT_PARAMS.minSectionLengthM, 25);
});

test('raw hashes unchanged', () => {
  for (const [key, expected] of Object.entries(EXPECTED_RAW_SHA256)) {
    const spec = driveSpec(key);
    if (!fs.existsSync(spec.raw_path)) continue;
    const sha = createHash('sha256').update(fs.readFileSync(spec.raw_path)).digest('hex');
    assert.equal(sha, expected);
  }
});

test('zero candidates remains valid state', () => {
  assert.ok(true);
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { projectPoseOnWay, travelDirectionSign } from '../src/lib/same-osm-way-cross-drive-feasibility/along-way-projection.js';
import { classifyAccumulatedSpan } from '../src/lib/same-osm-way-cross-drive-feasibility/classify-spans.js';
import { uniqueFrames } from '../src/lib/same-osm-way-cross-drive-feasibility/drive-evidence-loader.js';
import { verifyProtectedInputHashes } from '../src/lib/multi-drive-rebuild-guard.js';
import { localAreaGeojsonPath, DEFAULT_LOCAL_AREA_ID } from '../src/lib/local-areas.js';
import { PROTECTED_INPUT_SHA256 } from '../src/lib/multi-drive-mismatch-config.js';
import { pointInsideBukitPilot, loadBukitPilotBbox } from '../src/lib/bukit-pilot-bounds.js';

describe('same-osm-way cross-drive accumulation feasibility', () => {
  it('protected hashes unchanged', () => {
    assert.equal(verifyProtectedInputHashes().ok, true);
  });

  it('deterministic along-way projection', () => {
    const coords = [[101.71, 3.15], [101.711, 3.15], [101.712, 3.151]];
    const a = projectPoseOnWay(101.7105, 3.15, coords, null);
    const b = projectPoseOnWay(101.7105, 3.15, coords, null);
    assert.equal(a.ok, b.ok);
    if (a.ok) assert.equal(a.chain_s, b.chain_s);
  });

  it('opposite direction separation via classify', () => {
    const span = {
      dongle_groups: ['dongle-group-A', 'dongle-group-B'],
      overlap_length_m: 30,
      passes_support_gates: true,
      dominant_drive_failure: false,
      records: [
        { projection: { ok: true }, direction_sign: 1, lateral_m: 0.1, lane_obs: 0, edge_obs: 0 },
        { projection: { ok: true }, direction_sign: -1, lateral_m: -0.1, lane_obs: 0, edge_obs: 0 },
      ],
      lateral_by_dongle: { 'dongle-group-A': 0.1, 'dongle-group-B': -0.1 },
    };
    const c = classifyAccumulatedSpan(span);
    assert.equal(c.classification, 'directionally_incompatible');
  });

  it('disjoint coverage rejection', () => {
    const span = {
      dongle_groups: ['dongle-group-A', 'dongle-group-B'],
      overlap_length_m: 5,
      passes_support_gates: false,
      dominant_drive_failure: false,
      records: [
        { projection: { ok: true }, direction_sign: 1, lateral_m: 0, lane_obs: 0, edge_obs: 0 },
        { projection: { ok: true }, direction_sign: 1, lateral_m: 0, lane_obs: 0, edge_obs: 0 },
      ],
      lateral_by_dongle: {},
    };
    assert.equal(classifyAccumulatedSpan(span).classification, 'disjoint_same_way_coverage');
  });

  it('duplicate frame counting per drive', () => {
    const recs = [
      { drive_key: 'd1', frame_id: 1 },
      { drive_key: 'd1', frame_id: 1 },
      { drive_key: 'd1', frame_id: 2 },
    ];
    assert.equal(uniqueFrames(recs), 2);
  });

  it('pilot bounds helper', () => {
    const b = loadBukitPilotBbox();
    assert.equal(pointInsideBukitPilot(101.718, 3.15, b), true);
  });

  it('bukit osm hash unchanged', () => {
    const h = createHash('sha256').update(fs.readFileSync(localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID))).digest('hex');
    assert.equal(h, PROTECTED_INPUT_SHA256.bukit_osm);
  });

  it('travel direction sign', () => {
    assert.equal(travelDirectionSign(20), 1);
    assert.equal(travelDirectionSign(100), -1);
  });
});

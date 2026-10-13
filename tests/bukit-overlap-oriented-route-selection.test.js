import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { computePairwiseOverlap } from '../src/lib/bukit-overlap-route-selection/pairwise-overlap.js';
import { activeAnchoredRanking, globalOverlapRanking } from '../src/lib/bukit-overlap-route-selection/rankings.js';
import { verifyProtectedInputHashes } from '../src/lib/multi-drive-rebuild-guard.js';
import { localAreaGeojsonPath, DEFAULT_LOCAL_AREA_ID } from '../src/lib/local-areas.js';
import { PROTECTED_INPUT_SHA256 } from '../src/lib/multi-drive-mismatch-config.js';
import { resolveUpdatePreviewPaths } from '../src/lib/update-preview-paths.js';

describe('bukit overlap-oriented route selection', () => {
  it('protected hashes unchanged', () => {
    assert.equal(verifyProtectedInputHashes().ok, true);
  });

  it('pairwise overlap symmetry fields', () => {
    const a = {
      route_key: 'a',
      osm_records: {
        '1': [
          { frame_id: 1, chain_s: 10, lateral_m: 0.1, direction_sign: 1, lane_obs: 1, edge_obs: 0 },
          { frame_id: 3, chain_s: 40, lateral_m: 0.1, direction_sign: 1, lane_obs: 1, edge_obs: 0 },
        ],
      },
    };
    const b = {
      route_key: 'b',
      osm_records: {
        '1': [
          { frame_id: 2, chain_s: 15, lateral_m: 0.2, direction_sign: 1, lane_obs: 0, edge_obs: 1 },
          { frame_id: 4, chain_s: 35, lateral_m: 0.2, direction_sign: 1, lane_obs: 0, edge_obs: 1 },
        ],
      },
    };
    const row = computePairwiseOverlap(a, b, { dongle_group: 'A', redacted_route_ref: 'ra' }, { dongle_group: 'B', redacted_route_ref: 'rb' });
    assert.ok(row.overlapping_osm_ways >= 1);
    assert.equal(row.independent_compatible_overlaps, 1);
  });

  it('disjoint same osm_id yields zero overlap length', () => {
    const a = {
      osm_records: { '1': [{ frame_id: 1, chain_s: 0, lateral_m: 0, direction_sign: 1, lane_obs: 0, edge_obs: 0 }] },
    };
    const b = {
      osm_records: { '1': [{ frame_id: 2, chain_s: 100, lateral_m: 0, direction_sign: 1, lane_obs: 0, edge_obs: 0 }] },
    };
    const row = computePairwiseOverlap(a, b, { dongle_group: 'A' }, { dongle_group: 'B' });
    assert.equal(row.total_overlap_length_m, 0);
  });

  it('deterministic ranking order', () => {
    const matrix = [
      { route_a: 'active', route_b: 'drive-005', independent_compatible_overlaps: 1, independent_overlap_length_m: 30, spans_ge_25m: 1, spans_ge_10m: 1, joint_frames: 20 },
      { route_a: 'active', route_b: 'drive-007', independent_compatible_overlaps: 0, independent_overlap_length_m: 0, spans_ge_25m: 0, spans_ge_10m: 0, joint_frames: 0 },
    ];
    const r1 = activeAnchoredRanking(matrix);
    const r2 = activeAnchoredRanking(matrix);
    assert.deepEqual(r1, r2);
  });

  it('active preview hash unchanged', () => {
    const p = resolveUpdatePreviewPaths().previewPath;
    const h = createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    assert.equal(h, PROTECTED_INPUT_SHA256['drive-active']);
  });

  it('bukit osm unchanged', () => {
    const h = createHash('sha256').update(fs.readFileSync(localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID))).digest('hex');
    assert.equal(h, PROTECTED_INPUT_SHA256.bukit_osm);
  });
});

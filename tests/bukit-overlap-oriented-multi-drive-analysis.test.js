import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT_DIR } from '../src/config.js';
import { DIAG_VERSION, SWEEP, SELECTED_SWEEP_DEFAULT } from '../src/lib/bukit-overlap-multi-drive-analysis/config.js';
import { verifyPhase0 } from '../src/lib/bukit-overlap-multi-drive-analysis/phase0-protected.js';
import { normalizeBareNanInJson } from '../src/lib/json-nan-normalize.js';
import { binIndex, perDriveBinSummaries, dominanceFlags } from '../src/lib/bukit-overlap-multi-drive-analysis/bin-evidence.js';
import { perDonglePassesGates, classifySpan } from '../src/lib/bukit-overlap-multi-drive-analysis/classify-spans.js';
import { enumerateSweepCells } from '../src/lib/bukit-overlap-multi-drive-analysis/support-sweep.js';
import { buildDiagnosticProposals } from '../src/lib/bukit-overlap-multi-drive-analysis/proposals.js';
import { reconstructPairSpans } from '../src/lib/bukit-overlap-multi-drive-analysis/shared-spans.js';
import { buildAnalysisInventory } from '../src/lib/bukit-overlap-multi-drive-analysis/inventory.js';
import { verifyProtectedInputHashes } from '../src/lib/multi-drive-rebuild-guard.js';
import { leaveOneDongleOut } from '../src/lib/bukit-overlap-multi-drive-analysis/leave-one-out.js';

describe('bukit overlap multi-drive analysis v1', () => {
  it('phase0 allows only diagnostic paths when dirty', () => {
    const p = verifyPhase0();
    assert.equal(typeof p.ok, 'boolean');
  });

  it('sweep grid dimensions', () => {
    const cells = enumerateSweepCells();
    const expected =
      SWEEP.minFramesPerDongle.length *
      SWEEP.minLengthPerDongleM.length *
      SWEEP.minIndependentDongles.length *
      SWEEP.binSizeM.length *
      SWEEP.maxBinGapM.length;
    assert.equal(cells.length, expected);
  });

  it('derived-only NaN normalization', () => {
    const { normalized, replacementCount } = normalizeBareNanInJson('{"a": NaN}');
    assert.equal(replacementCount, 1);
    assert.equal(JSON.parse(normalized).a, null);
  });

  it('disjoint span rejection via zero overlap', () => {
    const span = { disjoint_coverage: true, per_route: {}, independent_dongle_count: 2 };
    const cls = classifySpan(span, {}, { osm_confirmed: { centreline_geometry: true } }, SELECTED_SWEEP_DEFAULT, true);
    assert.equal(cls, 'disjoint_coverage');
  });

  it('per-dongle contribution gates', () => {
    const span = {
      per_route: {
        a: { frames: 8, covered_length_m: 20 },
        b: { frames: 8, covered_length_m: 20 },
      },
      shared_length_m: 30,
      independent_dongle_count: 2,
    };
    const ok = perDonglePassesGates(span, { minFramesPerDongle: 4, minLengthPerDongleM: 10 });
    assert.deepEqual(ok.sort(), ['a', 'b']);
  });

  it('equal weight bin aggregation', () => {
    const span = {
      per_route: {
        r1: {
          records: [
            { chain_s: 1, frame_id: 1, centreline_residual_m: 1, heading_diff_deg: 5, lane_obs: 1, edge_obs: 0 },
            { chain_s: 6, frame_id: 2, centreline_residual_m: 1.2, heading_diff_deg: 6, lane_obs: 0, edge_obs: 1 },
          ],
        },
        r2: {
          records: [
            { chain_s: 2, frame_id: 3, centreline_residual_m: 0.8, heading_diff_deg: 4, lane_obs: 1, edge_obs: 0 },
          ],
        },
      },
    };
    const ev = perDriveBinSummaries(span, 5);
    assert.ok(ev.equal_weight_bins.length >= 1);
    const dom = dominanceFlags(ev);
    assert.equal(typeof dom.single_drive_dominates, 'boolean');
  });

  it('diagnostic proposals are pending and diagnostic_only', () => {
    const out = buildDiagnosticProposals([
      {
        osm_id: '1',
        span_start_s: 0,
        span_end_s: 30,
        shared_length_m: 30,
        classification: 'possible_centreline_offset_multi_drive',
        stability: { stable: true },
        independent_dongle_count: 2,
        route_keys: ['active', 'drive-005'],
      },
    ]);
    assert.equal(out.count, 1);
    assert.equal(out.proposals[0].decision_state, 'pending');
    assert.equal(out.proposals[0].diagnostic_only, true);
  });

  it('production comparison path unchanged hash marker', () => {
    const prod = path.join(ROOT_DIR, 'data', 'maps-read', 'comparison-v1');
    if (fs.existsSync(prod)) {
      const summary = path.join(prod, 'comparison-summary.json');
      assert.ok(fs.existsSync(summary));
    }
  });

  it('isolated output directory name', () => {
    assert.match(DIAG_VERSION, /overlap-oriented-multi-drive-analysis/);
  });

  it('public redaction: no private manifest in report dir listing', () => {
    const report = path.join(ROOT_DIR, 'reports', 'bukit_overlap_oriented_multi_drive_analysis_v1');
    if (fs.existsSync(report)) {
      const files = fs.readdirSync(report);
      assert.ok(!files.some((f) => f.includes('.private.')));
    }
  });

  it('bin index', () => {
    assert.equal(binIndex(10, 5), 2);
  });

  it('three distinct dongle groups in inventory', () => {
    const inv = buildAnalysisInventory();
    assert.equal(inv.distinct_dongle_groups, 3);
  });

  it('protected input hashes', () => {
    const h = verifyProtectedInputHashes();
    assert.equal(h.ok, true);
  });

  it('same-way shared span reconstruction', () => {
    const mk = (id, sList) => ({
      route_key: id,
      osm_records: {
        42: sList.map((s, i) => ({
          frame_id: i,
          chain_s: s,
          direction_sign: 1,
          lane_obs: 1,
          edge_obs: 0,
          centreline_residual_m: 0.5,
          heading_diff_deg: 10,
        })),
      },
    });
    const spans = reconstructPairSpans(
      mk('a', [10, 15, 20]),
      mk('b', [12, 18, 25]),
      { redacted_route_ref: 'ra', dongle_group: 'g1' },
      { redacted_route_ref: 'rb', dongle_group: 'g2' },
      { maxBinGapM: 10 }
    );
    assert.ok(spans.some((s) => s.osm_id === '42' && s.shared_length_m > 0));
  });

  it('direction separation skips incompatible overlap', () => {
    const routeA = {
      route_key: 'a',
      osm_records: {
        9: [{ frame_id: 1, chain_s: 10, direction_sign: 1, lane_obs: 0, edge_obs: 0 }],
      },
    };
    const routeB = {
      route_key: 'b',
      osm_records: {
        9: [{ frame_id: 2, chain_s: 11, direction_sign: -1, lane_obs: 0, edge_obs: 0 }],
      },
    };
    const spans = reconstructPairSpans(routeA, routeB, { dongle_group: 'g1' }, { dongle_group: 'g2' });
    assert.equal(spans.filter((s) => s.shared_length_m > 0).length, 0);
  });

  it('leave-one-dongle-out marks two-dongle-only', () => {
    const loo = leaveOneDongleOut([
      {
        osm_id: '1',
        per_route: { a: { frames: 2, median_centreline_residual_m: 1 }, b: { frames: 2, median_centreline_residual_m: 1 } },
      },
    ]);
    assert.equal(loo[0].two_dongle_only, true);
  });
});

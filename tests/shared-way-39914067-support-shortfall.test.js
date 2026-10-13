import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../src/config.js';
import { TARGET_OSM_WAY_ID, DIAG_VERSION } from '../src/lib/shared-way-support-shortfall/config.js';
import { verifyProtectedInputHashes } from '../src/lib/multi-drive-rebuild-guard.js';
import { auditOsmWay, lineLengthM } from '../src/lib/shared-way-support-shortfall/osm-way-audit.js';
import { gapsBetweenSpans, overlapSummary } from '../src/lib/shared-way-support-shortfall/span-trace.js';
import { classifyGap } from '../src/lib/shared-way-support-shortfall/gap-classification.js';
import { assessProcessingDefect } from '../src/lib/shared-way-support-shortfall/defect-assessment.js';
import { projectAlongCentreline } from '../src/lib/mismatch-projection.js';

describe('shared-way 39914067 support shortfall v1', () => {
  it('protected input hashes', () => {
    assert.equal(verifyProtectedInputHashes().ok, true);
  });

  it('exact way selection', () => {
    const audit = auditOsmWay();
    assert.equal(audit.osm_id, TARGET_OSM_WAY_ID);
    assert.ok(audit.geometry.length_m > 0);
  });

  it('deterministic along-way projection', () => {
    const audit = auditOsmWay();
    const c = audit.geometry.coordinates;
    const mid = c[Math.floor(c.length / 2)];
    const a = projectAlongCentreline(mid[0], mid[1], c);
    const b = projectAlongCentreline(mid[0], mid[1], c);
    assert.equal(a.chainS, b.chainS);
  });

  it('does not sum disjoint spans in summary helper', () => {
    const spans = [
      { shared_length_m: 10, span_start_s: 0, span_end_s: 10, direction_sign: 1 },
      { shared_length_m: 15, span_start_s: 50, span_end_s: 65, direction_sign: 1 },
    ];
    const s = overlapSummary(spans);
    assert.equal(s.total_separated_overlap_m, 25);
    assert.equal(s.longest_continuous_overlap_m, 15);
  });

  it('gap measurement between spans', () => {
    const spans = [
      { span_start_s: 0, span_end_s: 10, direction_sign: 1, shared_length_m: 10 },
      { span_start_s: 30, span_end_s: 40, direction_sign: 1, shared_length_m: 10 },
    ];
    const gaps = gapsBetweenSpans(spans);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].gap_length_m, 20);
  });

  it('multi-reason gap classification', () => {
    const g = classifyGap(
      { previous_span_end_s: 10, next_span_start_s: 30, gap_length_m: 20, direction_sign: 1 },
      { active: { poses: [] }, 'drive-005': { poses: [] } },
      []
    );
    assert.ok(g.reasons.includes('no_raw_vehicle_pose'));
    assert.ok(g.reasons.length >= 2);
  });

  it('defect proof requires strict criteria', () => {
    const d = assessProcessingDefect([], [{ route_key: 'active', buckets_summary: { matched_target: 1 } }], []);
    assert.equal(d.proven, false);
  });

  it('diagnostic version naming', () => {
    assert.match(DIAG_VERSION, /shared-way-39914067-support-shortfall/);
  });

  it('production comparison path not required to mutate', () => {
    const p = path.join(ROOT_DIR, 'data', 'maps-read', 'comparison-v1', 'comparison-summary.json');
    if (fs.existsSync(p)) {
      const before = fs.readFileSync(p);
      assert.ok(before.length > 0);
    }
  });
});

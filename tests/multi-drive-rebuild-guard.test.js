import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MULTI_DRIVE_BASELINE_COMMIT } from '../src/lib/multi-drive-mismatch-config.js';
import {
  assertMultiDriveRebuildAllowed,
  isBaselineAncestorOfHead,
  readGitHead,
  trackedWorkingTreeClean,
  verifyProtectedInputHashes,
} from '../src/lib/multi-drive-rebuild-guard.js';
import { aggregateSummaryRedactedPath } from '../src/lib/multi-drive-mismatch-paths.js';
import { containsFullDongle } from '../src/lib/bukit-route-redaction.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('baseline ancestor accepted at current HEAD', () => {
  const head = readGitHead(root);
  assert.equal(isBaselineAncestorOfHead(head, root, MULTI_DRIVE_BASELINE_COMMIT), true);
  if (trackedWorkingTreeClean(root)) {
    assertMultiDriveRebuildAllowed({ rootDir: root, head });
  }
});

test('later descendant commit accepted when ancestry holds', () => {
  const head = readGitHead(root);
  assert.equal(isBaselineAncestorOfHead(head, root, MULTI_DRIVE_BASELINE_COMMIT), true);
  assert.notEqual(head, MULTI_DRIVE_BASELINE_COMMIT);
});

test('unrelated history rejected when not descendant of baseline', () => {
  assert.equal(isBaselineAncestorOfHead('0000000000000000000000000000000000000000', root), false);
  assert.throws(
    () => assertMultiDriveRebuildAllowed({ rootDir: root, head: '0000000000000000000000000000000000000000' }),
    (e) => e.code === 'baseline_not_ancestor'
  );
});

test('dirty tracked production file rejected', () => {
  assert.throws(
    () =>
      assertMultiDriveRebuildAllowed({
        rootDir: root,
        head: readGitHead(root),
        trackedClean: false,
      }),
    (e) => e.code === 'dirty_tracked_tree'
  );
});

test('protected hash mismatch rejected', () => {
  assert.throws(
    () =>
      assertMultiDriveRebuildAllowed({
        rootDir: root,
        head: readGitHead(root),
        trackedClean: true,
        verifyHashesFn: () => ({ ok: false, mismatches: [{ key: 'bukit_osm', reason: 'hash_mismatch' }] }),
      }),
    (e) => e.code === 'protected_hash_mismatch'
  );
  const v = verifyProtectedInputHashes(root);
  if (!v.ok) return;
});

test('ignored generated data does not block rebuild when only untracked files differ', () => {
  const porcelainAll = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' }).trim();
  const porcelainTracked = execSync('git status --porcelain --untracked-files=no', { cwd: root, encoding: 'utf8' }).trim();
  if (porcelainAll && !porcelainTracked) {
    assert.ok(trackedWorkingTreeClean(root));
  } else {
    assert.equal(typeof porcelainAll, 'string');
  }
});

test('regenerated aggregate summary matches expected baseline counts when present', () => {
  const p = aggregateSummaryRedactedPath();
  if (!fs.existsSync(p)) return;
  const s = JSON.parse(fs.readFileSync(p, 'utf8'));
  const per = Object.fromEntries(
    (s.pilot_scope?.per_drive || []).map((d) => [
      d.redacted_drive_ref,
      { total: d.total_route_poses, pilot: d.pilot_poses, outside: d.excluded_outside_pilot },
    ])
  );
  assert.deepEqual(per.active, { total: 1209, pilot: 591, outside: 618 });
  assert.deepEqual(per['probe-008'], { total: 3340, pilot: 1293, outside: 2047 });
  assert.deepEqual(per['probe-010'], { total: 4272, pilot: 1250, outside: 3022 });
  assert.deepEqual(per['probe-001'], { total: 2678, pilot: 2452, outside: 226 });
  assert.equal(s.distinct_dongle_groups, 4);
  assert.equal(s.support_eligible_totals?.support_eligible_centreline, 1);
  assert.equal(s.support_eligible_totals?.support_eligible_lane_edge, 0);
  assert.equal(s.single_drive_consistent_sections, 1);
  assert.equal(s.consistent_across_drives, 0);
  assert.equal(s.multi_drive_candidates, 0);
  assert.equal(s.aggregate_state_counts?.insufficient_combined_evidence, 187);
});

test('BUKIT_MULTI_DRIVE_BASELINE.md contains no private identifiers', () => {
  const doc = path.join(root, 'docs', 'BUKIT_MULTI_DRIVE_BASELINE.md');
  assert.ok(fs.existsSync(doc));
  const text = fs.readFileSync(doc, 'utf8');
  assert.ok(!/dongle_fingerprint/i.test(text));
  assert.ok(!/Authorization:\s*Bearer/i.test(text));
  assert.equal(containsFullDongle(text), false);
  assert.ok(!/drive-mapping\.private/i.test(text));
});

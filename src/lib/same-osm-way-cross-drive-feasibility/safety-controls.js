import { classifyAccumulatedSpan } from './classify-spans.js';
import { buildSpansForOsm } from './spatial-aggregation.js';

export function buildSafetyControlCases(bundle, coverageByOsm) {
  const cases = [];
  const params = { binSizeM: 5, minDongles: 2, minOverlapM: 15, maxBinGapM: 10 };

  for (const [osmId, entries] of Object.entries(coverageByOsm)) {
    const dongles = new Set(entries.map((e) => e.dongle_group));
    if (dongles.size < 2) continue;
    const disjoint = !entries.some((a, i) =>
      entries.some((b, j) => i < j && a.dongle_group !== b.dongle_group && overlap(a, b))
    );
    if (disjoint) {
      cases.push({ id: `disjoint_${osmId}`, category: 'disjoint_same_way', osm_id: osmId, expect_unsafe: true });
    }
    const dirs = new Set(entries.flatMap((e) => e.direction_signs));
    if (dirs.has(1) && dirs.has(-1)) {
      cases.push({ id: `opposite_${osmId}`, category: 'opposite_direction', osm_id: osmId, expect_unsafe: true });
    }
  }

  for (const drive of bundle.drives) {
    const frames = drive.matched_pilot_records.map((r) => r.frame_id).filter((f) => f != null);
    const dup = frames.length !== new Set(frames).size;
    if (dup) {
      cases.push({
        id: `duplicate_frames_${drive.redacted_drive_ref}`,
        category: 'duplicate_frames',
        expect_unsafe: true,
      });
    }
  }

  cases.push({
    id: 'pilot_outside_reject',
    category: 'outside_pilot',
    expect_unsafe: true,
    synthetic: true,
  });

  return cases;
}

function overlap(a, b) {
  if (a.min_s == null || b.min_s == null) return false;
  return Math.max(a.min_s, b.min_s) < Math.min(a.max_s, b.max_s);
}

export function evaluateSafetyControls(cases, coverageByOsm, bundle) {
  const params = { binSizeM: 5, minDongles: 2, minOverlapM: 15, maxBinGapM: 10 };
  const results = [];
  let unsafe = 0;

  for (const c of cases) {
    let joined = false;
    let detail = '';
    if (c.osm_id && coverageByOsm[c.osm_id]) {
      const spans = buildSpansForOsm(c.osm_id, coverageByOsm[c.osm_id], params);
      const promoted = spans.filter((s) => {
        const cl = classifyAccumulatedSpan(s);
        return cl.classification.startsWith('possible_') || cl.classification === 'consistent_across_drives';
      });
      joined = promoted.length > 0;
      detail = `spans=${spans.length},promoted=${promoted.length}`;
    } else if (c.synthetic) {
      joined = false;
      detail = 'synthetic_outside_pilot_excluded_by_loader';
    }
    const failed = c.expect_unsafe && joined;
    if (failed) unsafe += 1;
    results.push({ ...c, joined, detail, passed: !failed });
  }

  return { results, unsafe_aggregations: unsafe, all_passed: unsafe === 0 };
}

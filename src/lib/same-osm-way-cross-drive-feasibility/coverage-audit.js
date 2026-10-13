import { DEFAULT_PARAMS } from '../mismatch-classify.js';
import { chainLengthFromRecords, uniqueFrames } from './drive-evidence-loader.js';

function binsFromRecords(records, binSizeM) {
  const bins = new Set();
  for (const r of records) {
    if (r.chain_s == null) continue;
    bins.add(Math.floor(r.chain_s / binSizeM));
  }
  return bins;
}

function spanFromBins(bins, binSizeM) {
  if (!bins.size) return null;
  const arr = [...bins].sort((a, b) => a - b);
  return {
    min_bin: arr[0],
    max_bin: arr[arr.length - 1],
    min_s: arr[0] * binSizeM,
    max_s: (arr[arr.length - 1] + 1) * binSizeM,
    bin_count: arr.length,
  };
}

function overlapLength(minA, maxA, minB, maxB) {
  const lo = Math.max(minA, minB);
  const hi = Math.min(maxA, maxB);
  return Math.max(0, hi - lo);
}

export function auditInputCoverage(bundle, { binSizeM = 5 } = {}) {
  const perDriveOsm = [];
  const byOsm = new Map();

  for (const drive of bundle.drives) {
    const osmSet = new Set();
    const grouped = new Map();
    for (const r of drive.matched_pilot_records) {
      if (!r.projection?.ok) continue;
      osmSet.add(r.osm_id);
      if (!grouped.has(r.osm_id)) grouped.set(r.osm_id, []);
      grouped.get(r.osm_id).push(r);
    }
    perDriveOsm.push({
      redacted_drive_ref: drive.redacted_drive_ref,
      dongle_group: drive.dongle_group,
      distinct_osm_ways: osmSet.size,
      osm_ids: [...osmSet].sort(),
    });

    for (const [osmId, recs] of grouped) {
      if (!byOsm.has(osmId)) byOsm.set(osmId, []);
      const dirs = new Set(recs.map((r) => r.direction_sign).filter((d) => d !== 0));
      const span = spanFromBins(binsFromRecords(recs, binSizeM), binSizeM);
      byOsm.get(osmId).push({
        redacted_drive_ref: drive.redacted_drive_ref,
        dongle_group: drive.dongle_group,
        records: recs,
        direction_signs: [...dirs],
        distinct_frames: uniqueFrames(recs),
        matched_poses: recs.length,
        lane_obs: recs.reduce((s, r) => s + r.lane_obs, 0),
        edge_obs: recs.reduce((s, r) => s + r.edge_obs, 0),
        min_s: span?.min_s ?? null,
        max_s: span?.max_s ?? null,
        occupied_bins: span ? span.bin_count : 0,
        supported_length_m: chainLengthFromRecords(recs),
        passes_min_frames: uniqueFrames(recs) >= DEFAULT_PARAMS.minFrames,
        passes_min_length: chainLengthFromRecords(recs) >= DEFAULT_PARAMS.minSectionLengthM,
        parallel_ambiguity_frames: recs.filter((r) => r.parallel_ambiguity).length,
        heading_rejects: recs.filter((r) => (r.heading_diff_deg || 0) > DEFAULT_PARAMS.maxHeadingDiffDeg).length,
      });
    }
  }

  let twoPlusDongles = 0;
  let threePlusDongles = 0;
  let overlappingPairs = 0;
  let disjointSameWay = 0;
  let directionIncompatible = 0;

  const osmMulti = [];
  for (const [osmId, entries] of byOsm) {
    const dongles = new Set(entries.map((e) => e.dongle_group).filter(Boolean));
    if (dongles.size >= 2) twoPlusDongles += 1;
    if (dongles.size >= 3) threePlusDongles += 1;
    if (dongles.size < 2) continue;

    let hasOverlap = false;
    let hasDisjoint = false;
    let dirConflict = false;
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i];
        const b = entries[j];
        if (a.dongle_group === b.dongle_group) continue;
        if (a.min_s == null || b.min_s == null) continue;
        const ov = overlapLength(a.min_s, a.max_s, b.min_s, b.max_s);
        if (ov > 0) {
          hasOverlap = true;
          overlappingPairs += 1;
        } else hasDisjoint = true;
        const da = a.direction_signs[0];
        const db = b.direction_signs[0];
        if (da && db && da !== db) dirConflict = true;
      }
    }
    if (hasDisjoint && !hasOverlap) disjointSameWay += 1;
    if (dirConflict) directionIncompatible += 1;
    osmMulti.push({ osm_id: osmId, dongle_count: dongles.size, has_overlap: hasOverlap, has_disjoint: hasDisjoint });
  }

  return {
    per_drive: perDriveOsm,
    by_osm_way: Object.fromEntries(byOsm),
    summary: {
      distinct_osm_per_drive: perDriveOsm,
      osm_ways_two_plus_dongles: twoPlusDongles,
      osm_ways_three_plus_dongles: threePlusDongles,
      overlapping_dongle_pairs: overlappingPairs,
      disjoint_same_way_cases: disjointSameWay,
      direction_incompatible_osm_ways: directionIncompatible,
      osm_multi_detail: osmMulti,
    },
  };
}

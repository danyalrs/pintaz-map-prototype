import { median } from '../geo-segment.js';
import {
  BIN_SIZE_GRID_M,
  MIN_DONGLES_GRID,
  MIN_OVERLAP_GRID_M,
  MAX_BIN_GAP_GRID_M,
  SUPPORT_PARAMS,
  DOMINANT_DRIVE_FRACTION,
} from './config.js';
import { uniqueFrames, chainLengthFromRecords } from './drive-evidence-loader.js';

function occupiedBins(records, binSizeM) {
  const m = new Map();
  for (const r of records) {
    if (r.chain_s == null || !r.projection?.ok) continue;
    const b = Math.floor(r.chain_s / binSizeM);
    if (!m.has(b)) m.set(b, []);
    m.get(b).push(r);
  }
  return m;
}

function mergeBins(bins, maxGapBins) {
  const keys = [...bins.keys()].sort((a, b) => a - b);
  const spans = [];
  let cur = null;
  for (const k of keys) {
    if (!cur) cur = { start: k, end: k };
    else if (k - cur.end <= maxGapBins) cur.end = k;
    else {
      spans.push(cur);
      cur = { start: k, end: k };
    }
  }
  if (cur) spans.push(cur);
  return spans.map((s) => ({
    start_bin: s.start,
    end_bin: s.end,
    min_s: s.start * bins.get(s.start) ? 0 : 0,
  }));
}

function spanMetrics(records, binSizeM, startBin, endBin) {
  const inSpan = records.filter((r) => {
    if (r.chain_s == null) return false;
    const b = Math.floor(r.chain_s / binSizeM);
    return b >= startBin && b <= endBin;
  });
  const byDongle = new Map();
  for (const r of inSpan) {
    const g = r.dongle_group || 'unknown';
    if (!byDongle.has(g)) byDongle.set(g, []);
    byDongle.get(g).push(r);
  }
  const dongleGroups = [...byDongle.keys()];
  let overlapS = 0;
  if (dongleGroups.length >= 2) {
    const ranges = dongleGroups.map((g) => {
      const rs = byDongle.get(g).filter((r) => r.chain_s != null);
      return { min: Math.min(...rs.map((x) => x.chain_s)), max: Math.max(...rs.map((x) => x.chain_s)) };
    });
    overlapS = Math.max(
      0,
      Math.min(...ranges.map((r) => r.max)) - Math.max(...ranges.map((r) => r.min))
    );
  }
  const frames = uniqueFrames(inSpan);
  const lengthM = chainLengthFromRecords(inSpan);
  const lateralByDongle = {};
  for (const [g, rs] of byDongle) {
    const vals = rs.map((r) => r.lateral_m).filter((v) => v != null);
    lateralByDongle[g] = vals.length ? median(vals) : null;
  }
  const frameCounts = Object.fromEntries([...byDongle.entries()].map(([g, rs]) => [g, uniqueFrames(rs)]));
  const totalFrames = frames;
  let dominant = null;
  let maxShare = 0;
  for (const [g, c] of Object.entries(frameCounts)) {
    const share = totalFrames ? c / totalFrames : 0;
    if (share > maxShare) {
      maxShare = share;
      dominant = g;
    }
  }
  return {
    records: inSpan,
    dongle_groups: dongleGroups,
    overlap_length_m: overlapS,
    combined_frames: frames,
    supported_length_m: lengthM,
    lateral_by_dongle: lateralByDongle,
    frame_counts_by_dongle: frameCounts,
    dominant_dongle: dominant,
    dominant_fraction: maxShare,
  };
}

function directionCompatible(records) {
  const signs = new Set(records.map((r) => r.direction_sign).filter((s) => s !== 0));
  return signs.size <= 1;
}

function passesSupport(metrics) {
  return (
    metrics.combined_frames >= SUPPORT_PARAMS.minFrames &&
    metrics.supported_length_m >= SUPPORT_PARAMS.minSectionLengthM &&
    metrics.overlap_length_m >= SUPPORT_PARAMS.minSectionLengthM
  );
}

export function buildSpansForOsm(osmId, driveEntries, params) {
  const { binSizeM, minDongles, minOverlapM, maxBinGapM } = params;
  const maxGapBins = Math.ceil(maxBinGapM / binSizeM);
  const allRecords = driveEntries.flatMap((e) => e.records);
  const bins = occupiedBins(allRecords, binSizeM);
  const spans = [];
  const keys = [...bins.keys()].sort((a, b) => a - b);
  let cur = null;
  for (const k of keys) {
    if (!cur) cur = { start: k, end: k };
    else if (k - cur.end <= maxGapBins) cur.end = k;
    else {
      spans.push(cur);
      cur = { start: k, end: k };
    }
  }
  if (cur) spans.push(cur);

  const qualified = [];
  for (const sp of spans) {
    const metrics = spanMetrics(allRecords, binSizeM, sp.start, sp.end);
    if (metrics.dongle_groups.length < minDongles) continue;
    if (metrics.overlap_length_m < minOverlapM) continue;
    if (!directionCompatible(metrics.records)) continue;
    qualified.push({
      osm_id: osmId,
      start_bin: sp.start,
      end_bin: sp.end,
      min_s: sp.start * binSizeM,
      max_s: (sp.end + 1) * binSizeM,
      ...metrics,
      passes_support_gates: passesSupport(metrics),
      dominant_drive_failure: metrics.dominant_fraction >= DOMINANT_DRIVE_FRACTION,
    });
  }
  return qualified;
}

export function runSpatialAggregationSweep(bundle, coverageByOsm) {
  const results = [];
  for (const binSizeM of BIN_SIZE_GRID_M) {
    for (const minDongles of MIN_DONGLES_GRID) {
      for (const minOverlapM of MIN_OVERLAP_GRID_M) {
        for (const maxBinGapM of MAX_BIN_GAP_GRID_M) {
          const params = { binSizeM, minDongles, minOverlapM, maxBinGapM };
          let qualifyingSpans = 0;
          let supportCentre = 0;
          let supportLane = 0;
          let dominantFailures = 0;
          let directionFailures = 0;
          let disjointFailures = 0;
          const osmWithQualifying = new Set();

          for (const [osmId, entries] of Object.entries(coverageByOsm)) {
            const spans = buildSpansForOsm(osmId, entries, params);
            if (spans.length) osmWithQualifying.add(osmId);
            for (const s of spans) {
              qualifyingSpans += 1;
              if (s.passes_support_gates) supportCentre += 1;
              if (s.dominant_drive_failure) dominantFailures += 1;
            }
            const dongles = new Set(entries.map((e) => e.dongle_group));
            if (dongles.size >= 2) {
              const hasOv = entries.some((a, i) =>
                entries.some((b, j) => i < j && a.dongle_group !== b.dongle_group && overlap(a, b))
              );
              if (!hasOv) disjointFailures += 1;
            }
            if (
              entries.some((e) => e.direction_signs.length > 1) ||
              new Set(entries.flatMap((e) => e.direction_signs)).size > 1
            ) {
              directionFailures += 1;
            }
          }

          results.push({
            ...params,
            osm_ways_with_qualifying_spans: osmWithQualifying.size,
            qualifying_span_count: qualifyingSpans,
            support_eligible_centreline_spans: supportCentre,
            support_eligible_lane_edge_spans: supportLane,
            dominant_drive_failures: dominantFailures,
            directionality_failures: directionFailures,
            disjoint_coverage_failures: disjointFailures,
          });
        }
      }
    }
  }
  return results;
}

function overlap(a, b) {
  if (a.min_s == null || b.min_s == null) return false;
  return Math.max(a.min_s, b.min_s) < Math.min(a.max_s, b.max_s);
}

export function selectTightestUsefulParams(sweep) {
  const useful = sweep.filter((r) => r.qualifying_span_count > 0 && r.support_eligible_centreline_spans > 0);
  if (!useful.length) {
    const any = sweep.filter((r) => r.qualifying_span_count > 0);
    if (!any.length) return null;
    any.sort((a, b) => {
      if (a.binSizeM !== b.binSizeM) return a.binSizeM - b.binSizeM;
      if (a.minOverlapM !== b.minOverlapM) return b.minOverlapM - a.minOverlapM;
      return a.minDongles - b.minDongles;
    });
    return any[0];
  }
  useful.sort((a, b) => {
    if (a.binSizeM !== b.binSizeM) return a.binSizeM - b.binSizeM;
    if (a.minOverlapM !== b.minOverlapM) return b.minOverlapM - a.minOverlapM;
    if (a.minDongles !== b.minDongles) return b.minDongles - a.minDongles;
    return a.maxBinGapM - b.maxBinGapM;
  });
  return useful[0];
}

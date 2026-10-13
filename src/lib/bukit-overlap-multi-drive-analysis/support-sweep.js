import { SWEEP } from './config.js';
import { perDonglePassesGates, combinedSupport, classifySpan } from './classify-spans.js';
import { perDriveBinSummaries } from './bin-evidence.js';
import { compareSpanToOsmBaseline, loadOsmRoadById, loadRoadIndex } from './osm-baseline.js';

export function enumerateSweepCells() {
  const cells = [];
  for (const minFrames of SWEEP.minFramesPerDongle) {
    for (const minLen of SWEEP.minLengthPerDongleM) {
      for (const minDongles of SWEEP.minIndependentDongles) {
        for (const binSize of SWEEP.binSizeM) {
          for (const maxGap of SWEEP.maxBinGapM) {
            cells.push({
              minFramesPerDongle: minFrames,
              minLengthPerDongleM: minLen,
              minIndependentDongles: minDongles,
              binSizeM: binSize,
              maxBinGapM: maxGap,
            });
          }
        }
      }
    }
  }
  return cells;
}

export function evaluateSpanAtCell(span, osmBaseline, cell) {
  const evidence = perDriveBinSummaries(span, cell.binSizeM);
  const contributors = perDonglePassesGates(span, cell);
  const crossDrive =
    contributors.length >= cell.minIndependentDongles && span.independent_dongle_count >= cell.minIndependentDongles;
  const support = combinedSupport(span);
  const classification = classifySpan(span, evidence, osmBaseline, cell, true);
  return {
    cell,
    cross_drive_supported: crossDrive && support.gate_failures.length === 0,
    classification,
    contributors,
    combined_support: support,
  };
}

export function runSupportSweep(spans) {
  const roadById = loadOsmRoadById();
  const roadIndex = loadRoadIndex();
  const cells = enumerateSweepCells();
  const results = [];
  for (const cell of cells) {
    let qualifying = 0;
    for (const span of spans) {
      const baseline = compareSpanToOsmBaseline(span.osm_id, roadById, roadIndex);
      const ev = evaluateSpanAtCell(span, baseline, cell);
      if (ev.cross_drive_supported) qualifying += 1;
    }
    results.push({ ...cell, qualifying_spans: qualifying });
  }
  return results;
}

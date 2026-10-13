import { reconstructPairSpans, reconstructSetSpans } from './shared-spans.js';
import { perDriveBinSummaries } from './bin-evidence.js';
import { classifySpan, stabilityAcrossSweep } from './classify-spans.js';
import { compareSpanToOsmBaseline, loadOsmRoadById, loadRoadIndex } from './osm-baseline.js';
import { enumerateSweepCells } from './support-sweep.js';
import { SELECTED_SWEEP_DEFAULT } from './config.js';

function metaMap(inventory) {
  const m = new Map();
  for (const r of inventory.routes) {
    m.set(r.route_key, { redacted_route_ref: r.public.redacted_route_ref, dongle_group: r.public.dongle_group });
  }
  return m;
}

function summarizeSpans(spans, inventory) {
  const roadById = loadOsmRoadById();
  const roadIndex = loadRoadIndex();
  const osmBaseline = (id) => compareSpanToOsmBaseline(id, roadById, roadIndex);
  const classified = [];
  for (const span of spans) {
    const evidence = perDriveBinSummaries(span, SELECTED_SWEEP_DEFAULT.binSizeM);
    const baseline = osmBaseline(span.osm_id);
    const sweepLabels = enumerateSweepCells()
      .filter(
        (c) =>
          c.minFramesPerDongle === SELECTED_SWEEP_DEFAULT.minFramesPerDongle &&
          c.minLengthPerDongleM === SELECTED_SWEEP_DEFAULT.minLengthPerDongleM &&
          c.minIndependentDongles === SELECTED_SWEEP_DEFAULT.minIndependentDongles
      )
      .map((c) => classifySpan(span, perDriveBinSummaries(span, c.binSizeM), baseline, c, true));
    const stability = stabilityAcrossSweep(sweepLabels);
    const classification = classifySpan(span, evidence, baseline, SELECTED_SWEEP_DEFAULT, stability.stable);
    classified.push({ ...span, evidence, classification, stability });
  }
  const tally = (pred) => classified.filter(pred);
  return {
    shared_osm_ways: new Set(spans.map((s) => s.osm_id)).size,
    shared_spans: spans.length,
    repeated_road_length_m: spans.reduce((s, x) => s + (x.shared_length_m || 0), 0),
    support_eligible_centreline: tally((s) => s.classification === 'consistent_with_osm_centreline' || s.classification.startsWith('possible_centreline')).length,
    support_eligible_lane_edge: tally((s) => s.classification.includes('lane') || s.classification.includes('edge')).length,
    consistent_spans: tally((s) => s.classification.startsWith('consistent_')).length,
    possible_mismatch_spans: tally((s) => s.classification.startsWith('possible_')).length,
    conflicting_spans: tally((s) => s.classification === 'drive_evidence_conflict').length,
    insufficient_spans: tally((s) => s.classification === 'insufficient_independent_support').length,
    spans: classified,
  };
}

export function buildPairAndSetResults(matchingByKey, inventory) {
  const meta = metaMap(inventory);
  const routes = [...matchingByKey.values()];
  const byKey = matchingByKey;
  const active = byKey.get('active');
  const d005 = byKey.get('drive-005');
  const d007 = byKey.get('drive-007');

  const pairActive005 = reconstructPairSpans(active, d005, meta.get('active'), meta.get('drive-005'));
  const pairActive007 = reconstructPairSpans(active, d007, meta.get('active'), meta.get('drive-007'));
  const pair005007 = reconstructPairSpans(d005, d007, meta.get('drive-005'), meta.get('drive-007'));
  const setAll = reconstructSetSpans(routes, meta);

  return {
    'active+drive-005': summarizeSpans(pairActive005, inventory),
    'active+drive-007': summarizeSpans(pairActive007, inventory),
    'drive-005+drive-007': summarizeSpans(pair005007, inventory),
    'active+drive-005+drive-007': summarizeSpans(setAll, inventory),
  };
}

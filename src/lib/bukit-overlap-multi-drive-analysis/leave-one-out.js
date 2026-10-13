import { classifySpan } from './classify-spans.js';
import { perDriveBinSummaries } from './bin-evidence.js';
import { compareSpanToOsmBaseline, loadOsmRoadById, loadRoadIndex } from './osm-baseline.js';
import { SELECTED_SWEEP_DEFAULT } from './config.js';

export function leaveOneDongleOut(spans) {
  const roadById = loadOsmRoadById();
  const roadIndex = loadRoadIndex();
  const results = [];
  for (const span of spans) {
    const routeKeys = Object.keys(span.per_route || {});
    if (routeKeys.length < 3) {
      results.push({
        osm_id: span.osm_id,
        span_start_s: span.span_start_s,
        span_end_s: span.span_end_s,
        two_dongle_only: true,
        per_dongle_residual: Object.fromEntries(
          routeKeys.map((rk) => [
            rk,
            {
              frames: span.per_route[rk].frames,
              median_centreline_residual_m: span.per_route[rk].median_centreline_residual_m,
            },
          ])
        ),
      });
      continue;
    }
    const baseline = compareSpanToOsmBaseline(span.osm_id, roadById, roadIndex);
    const baseEvidence = perDriveBinSummaries(span, SELECTED_SWEEP_DEFAULT.binSizeM);
    const baseClass = classifySpan(span, baseEvidence, baseline, SELECTED_SWEEP_DEFAULT, true);
    const removals = [];
    for (const drop of routeKeys) {
      const shrunk = {
        ...span,
        per_route: Object.fromEntries(Object.entries(span.per_route).filter(([k]) => k !== drop)),
        independent_dongle_count: (span.independent_dongle_count || routeKeys.length) - 1,
      };
      const ev = perDriveBinSummaries(shrunk, SELECTED_SWEEP_DEFAULT.binSizeM);
      const cls = classifySpan(shrunk, ev, baseline, SELECTED_SWEEP_DEFAULT, true);
      removals.push({
        removed_route: drop,
        classification: cls,
        agreement_with_full: cls === baseClass,
        conclusion_lost: baseClass.startsWith('possible_') && cls !== baseClass,
      });
    }
    results.push({
      osm_id: span.osm_id,
      span_start_s: span.span_start_s,
      span_end_s: span.span_end_s,
      base_classification: baseClass,
      removals,
      stable: removals.every((r) => r.agreement_with_full),
    });
  }
  return results;
}

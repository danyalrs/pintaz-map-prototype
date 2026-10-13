import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../../config.js';
import { TARGET_WAYS, REPORT_DIR_NAME } from './constants.js';
import {
  loadPhase3Checkpoint,
  countPhase3Progress,
} from './phase3-checkpoint.js';
import { loadCoverageIndexSummary, loadUnknownLaneOsmWays } from './phase3-coverage-load.js';
import { PAIR_SHORTLIST_STATUS, PHASE3_GEOMETRY_GATES } from './phase3-constants.js';
import {
  buildPairShortlistRows,
  pairsForTargetWay,
  topFutureGeometryCandidates,
  SHORTLIST_NOT_OSM_ENRICHMENT,
  POINT_ONLY_LANE_COUNT_STATEMENT,
} from './phase3-shortlist.js';
import { ROUTE_VERDICT } from '../route-aware-lane-calibration-audit/constants.js';
import { INSUFFICIENT_SAME_ROUTE_LABELLED_SUPPORT } from '../route-aware-lane-calibration-audit/constants.js';

export const FINAL_RESULTS_SCHEMA = 'full-maps-read-final-phase3-results-v1';

export const REPORT_DIR = path.join(ROOT_DIR, 'reports', REPORT_DIR_NAME);

export const FUTURE_GEOMETRY_PAIR_DISCLAIMER =
  'Future geometry candidate only — not a confirmed OSM lane count. Point-only lane_point/edge_point/lane_index samples are not physical lane inventory.';

function redactOsmWayId(osmWayId) {
  const s = String(osmWayId);
  return `way-${s.slice(-6)}`;
}

function bucketRouteScreen(row) {
  if (!row) return 'other';
  if (row.completion_status === 'retryable' || row.retryable === true) return 'retryable';
  if (row.route_fetch_status === 'malformed_response') return 'malformed_response';
  if (row.route_verdict === ROUTE_VERDICT.QUALIFIED) return 'route_qualified_for_future_geometry';
  if (row.route_verdict === ROUTE_VERDICT.NOT_QUALIFIED) return 'route_not_qualified';
  if (row.route_verdict === ROUTE_VERDICT.NOT_EVALUABLE) return 'route_not_evaluable';
  return 'other';
}

function summarizeRouteScreens(checkpointRoutes) {
  const byVerdict = {
    route_qualified_for_future_geometry: 0,
    route_not_qualified: 0,
    route_not_evaluable: 0,
    other: 0,
  };
  const byBucket = {
    route_qualified_for_future_geometry: 0,
    route_not_qualified: 0,
    route_not_evaluable: 0,
    malformed_response: 0,
    retryable: 0,
    other: 0,
  };
  const rawReasonCounts = {};
  for (const row of Object.values(checkpointRoutes || {})) {
    const b = bucketRouteScreen(row);
    byBucket[b] = (byBucket[b] || 0) + 1;
    if (row.route_verdict === ROUTE_VERDICT.QUALIFIED) {
      byVerdict.route_qualified_for_future_geometry += 1;
    } else if (row.route_verdict === ROUTE_VERDICT.NOT_QUALIFIED) {
      byVerdict.route_not_qualified += 1;
    } else if (row.route_verdict === ROUTE_VERDICT.NOT_EVALUABLE) {
      byVerdict.route_not_evaluable += 1;
    } else {
      byVerdict.other += 1;
    }
    for (const r of row.disqualification_reasons || []) {
      rawReasonCounts[r] = (rawReasonCounts[r] || 0) + 1;
    }
  }
  return { byVerdict, byBucket, rawReasonCounts };
}

function redactPairRow(p) {
  return {
    route_ref: p.route_ref,
    dongle_ref: p.dongle_ref,
    osm_way_id_redacted: redactOsmWayId(p.osm_way_id),
    shortlist_status: p.shortlist_status,
    future_geometry_candidate_only: p.shortlist_status === PAIR_SHORTLIST_STATUS.FUTURE_GEOMETRY,
    not_a_confirmed_lane_count: true,
    selected_lane_count: null,
    matched_pose_count: p.matched_pose_count,
    median_distance_m: p.median_distance_m,
    median_heading_diff_deg: p.median_heading_diff_deg,
    direction_compatible_fraction: p.direction_compatible_fraction,
    continuous_covered_length_m: p.continuous_covered_length_m,
    shortlist_ranking_score: p.shortlist_ranking_score,
    route_verdict: p.route_verdict,
    route_qualification_evidence: p.route_qualification_evidence
      ? {
          route_fetch_status: p.route_qualification_evidence.route_fetch_status,
          eligible_labelled_ways: p.route_qualification_evidence.eligible_labelled_ways,
          labelled_ways_on_route: p.route_qualification_evidence.labelled_ways_on_route,
          disqualification_reasons: p.route_qualification_evidence.disqualification_reasons,
        }
      : null,
    ranking_basis: [
      'route_passed_labelled_way_holdout_screen',
      'matched_pose_count',
      'median_distance_m',
      'median_heading_diff_deg',
      'direction_compatible_fraction',
      'continuous_covered_length_m',
      'phase3_geometry_gates_straight_segment_eligibility',
    ],
    geometry_gates: PHASE3_GEOMETRY_GATES,
    disclaimer: FUTURE_GEOMETRY_PAIR_DISCLAIMER,
    point_only_limitation_note: p.point_only_limitation_note,
  };
}

function targetWayReport(pairs, wayId, unknownMeta) {
  const wayPairs = pairsForTargetWay(pairs, wayId);
  const qualifiedPairs = wayPairs.filter(
    (p) => p.shortlist_status === PAIR_SHORTLIST_STATUS.FUTURE_GEOMETRY
  );
  const best = qualifiedPairs[0] ?? wayPairs[0] ?? null;
  return {
    osm_way_id: wayId,
    osm_lane_status: unknownMeta?.lane_count_source ?? 'lane_count_unknown',
    covering_qualified_route_count: qualifiedPairs.length,
    covering_route_pairs_total: wayPairs.length,
    best_qualified_route_evidence: best
      ? {
          route_ref: best.route_ref,
          shortlist_status: best.shortlist_status,
          matched_pose_count: best.matched_pose_count,
          median_distance_m: best.median_distance_m,
          median_heading_diff_deg: best.median_heading_diff_deg,
          continuous_covered_length_m: best.continuous_covered_length_m,
          shortlist_ranking_score: best.shortlist_ranking_score,
        }
      : null,
    final_status: qualifiedPairs.length
      ? 'has_future_geometry_candidate_pairs'
      : wayPairs.length
        ? `best_pair_status_${wayPairs[0].shortlist_status}`
        : 'no_coverage_index_pairs',
    lane_count_inferred: false,
    selected_lane_count: null,
  };
}

export function buildFinalPhase3Results({
  checkpointPath,
  reportDir = REPORT_DIR,
} = {}) {
  const coverage = loadCoverageIndexSummary();
  const checkpoint = loadPhase3Checkpoint(checkpointPath);
  const routes = checkpoint.routes || {};
  const progress = countPhase3Progress(coverage.route_refs, routes);
  const routeQualMap = new Map(Object.entries(routes));
  const pairs = buildPairShortlistRows(coverage.way_rows, routeQualMap);
  const qualifiedRouteRefs = new Set(
    Object.values(routes)
      .filter((r) => r.route_verdict === ROUTE_VERDICT.QUALIFIED)
      .map((r) => r.route_ref)
  );
  const qualifiedRouteUnknownWayPairsBeforeGeometryGates = pairs.filter((p) =>
    qualifiedRouteRefs.has(p.route_ref)
  );
  const futurePairs = pairs.filter((p) => p.shortlist_status === PAIR_SHORTLIST_STATUS.FUTURE_GEOMETRY);
  const qualifiedPairsPassingPoseMinBeforeGeometryGate = qualifiedRouteUnknownWayPairsBeforeGeometryGates.filter(
    (p) =>
      p.shortlist_status === PAIR_SHORTLIST_STATUS.FUTURE_GEOMETRY ||
      p.shortlist_status === PAIR_SHORTLIST_STATUS.NOT_GEOMETRY_ELIGIBLE
  );
  const top20 = topFutureGeometryCandidates(pairs, 20);
  const unknownWays = loadUnknownLaneOsmWays();
  const screenSummary = summarizeRouteScreens(routes);

  const waysWithQualifiedCoverage = new Set(
    futurePairs.map((p) => String(p.osm_way_id))
  );

  const validation = {
    expected_relevant_routes: coverage.route_refs.length,
    routes_completed_total: progress.routes_completed_total,
    routes_pending: progress.routes_pending,
    routes_qualified_for_future_geometry: progress.routes_qualified_for_future_geometry,
    retryable_failure_count: progress.retryable_failure_count,
    checkpoint_route_rows: Object.keys(routes).length,
    matches_user_facts:
      progress.routes_completed_total === coverage.route_refs.length &&
      progress.routes_pending === 0 &&
      progress.routes_qualified_for_future_geometry === 198 &&
      progress.retryable_failure_count === 0,
  };

  const kamuningMeta = unknownWays.find((w) => w.osm_way_id === TARGET_WAYS.JALAN_KAMUNING);
  const kudaMeta = unknownWays.find((w) => w.osm_way_id === TARGET_WAYS.LORONG_KUDA);

  const summary = {
    schema: FINAL_RESULTS_SCHEMA,
    generated_at: new Date().toISOString(),
    validated_against: 'phase3-route-qualification.json',
    checkpoint_validation: validation,
    scope: {
      catalogue_routes_pose_indexed_phase2: 1706,
      relevant_routes_screened_phase3: progress.routes_completed_total,
      unknown_lane_osm_ways_with_any_route_coverage: coverage.unknown_lane_ways_with_coverage,
      route_way_pair_rows_phase2_index: coverage.way_row_count,
      routes_qualified_for_future_geometry: progress.routes_qualified_for_future_geometry,
      routes_pending: progress.routes_pending,
      retryable_failures: progress.retryable_failure_count,
    },
    route_screen_totals: screenSummary.byVerdict,
    route_screen_buckets: screenSummary.byBucket,
    raw_disqualification_reason_counts: screenSummary.rawReasonCounts,
    notable_reason_counts: {
      insufficient_same_route_labelled_support:
        screenSummary.rawReasonCounts[INSUFFICIENT_SAME_ROUTE_LABELLED_SUPPORT] ?? 0,
      passed_provisional_minimum_support_policy:
        screenSummary.rawReasonCounts.passed_provisional_minimum_support_policy ?? 0,
    },
    pair_shortlist: {
      total_pairs_in_coverage_index: pairs.length,
      qualified_route_unknown_way_pairs_before_geometry_gates:
        qualifiedRouteUnknownWayPairsBeforeGeometryGates.length,
      qualified_route_unknown_way_pairs_after_geometry_gates: futurePairs.length,
      qualified_route_pairs_pose_min_reached_before_geometry_gate:
        qualifiedPairsPassingPoseMinBeforeGeometryGate.length,
      future_geometry_candidate_pairs: futurePairs.length,
      pair_status_counts: countPairStatuses(pairs),
      unknown_lane_ways_with_at_least_one_qualified_route: waysWithQualifiedCoverage.size,
      geometry_gate_note:
        'Before geometry gates counts all Phase 2 index pairs whose route passed Phase 3 labelled-way qualification. After geometry gates counts future_geometry_candidate only (PHASE3_GEOMETRY_GATES in phase3-constants.js).',
    },
    route_verdict_label_mapping: {
      checkpoint_field: ROUTE_VERDICT.QUALIFIED,
      checkpoint_value_literal: 'route_qualified_for_experiment',
      report_label: 'route_qualified_for_future_geometry',
      explanation:
        'Phase 3 checkpoint stores route_verdict route_qualified_for_experiment (route-aware-lane-calibration-audit/constants.js). Final reports and pair shortlist use the human-readable label qualified for future geometry; countPhase3Progress exposes routes_qualified_for_future_geometry for the same rows.',
    },
    cross_route_prototype_pooling_used: false,
    lane_counts_inferred: 0,
    selected_lane_count_emitted: null,
    shortlist_statement: SHORTLIST_NOT_OSM_ENRICHMENT,
    point_only_statement: POINT_ONLY_LANE_COUNT_STATEMENT,
    target_ways: {
      jalan_kamuning_39914067: targetWayReport(pairs, TARGET_WAYS.JALAN_KAMUNING, kamuningMeta),
      lorong_kuda_706737045: targetWayReport(pairs, TARGET_WAYS.LORONG_KUDA, kudaMeta),
    },
    conclusion:
      'The selected pairs are ready only when ordered lane-boundary and road-edge polylines become available from Maps Read.',
  };

  const shortlistRedacted = {
    schema: `${FINAL_RESULTS_SCHEMA}-shortlist`,
    generated_at: summary.generated_at,
    future_geometry_candidate_only: true,
    not_osm_lane_count_enrichment: true,
    pair_count: futurePairs.length,
    pairs: futurePairs.map(redactPairRow),
  };

  const top20MdRows = top20.map((p, i) => {
    const r = redactPairRow(p);
    return `${i + 1}. **${r.route_ref}** × **${r.osm_way_id_redacted}** — poses=${r.matched_pose_count}, cont_len=${r.continuous_covered_length_m?.toFixed?.(1) ?? 'n/a'} m, med_dist=${r.median_distance_m?.toFixed?.(2) ?? 'n/a'} m, med_hdg=${r.median_heading_diff_deg?.toFixed?.(1) ?? 'n/a'}°, dir_frac=${r.direction_compatible_fraction?.toFixed?.(2) ?? 'n/a'}, score=${r.shortlist_ranking_score?.toFixed?.(2) ?? 'n/a'} — *${FUTURE_GEOMETRY_PAIR_DISCLAIMER}*`;
  });

  const md = `# Final Phase 3 results (read-only)

${SHORTLIST_NOT_OSM_ENRICHMENT}

${POINT_ONLY_LANE_COUNT_STATEMENT}

**No lane counts inferred. Every \`future_geometry_candidate\` row is for future geometry work only.**

## Checkpoint validation

| Check | Value |
|--------|------:|
| Relevant routes screened | **${validation.routes_completed_total}** |
| Routes pending | **${validation.routes_pending}** |
| \`route_qualified_for_future_geometry\` (checkpoint verdict \`${ROUTE_VERDICT.QUALIFIED}\`) | **${validation.routes_qualified_for_future_geometry}** |
| Retryable failures | **${validation.retryable_failure_count}** |
| Facts match expected completion | **${validation.matches_user_facts}** |

## 1. Route-screen totals

| Verdict | Count |
|---------|------:|
| Qualified for future geometry | **${screenSummary.byVerdict.route_qualified_for_future_geometry}** |
| \`route_not_qualified\` | **${screenSummary.byVerdict.route_not_qualified}** |
| \`route_not_evaluable\` | **${screenSummary.byVerdict.route_not_evaluable}** |
| Other | **${screenSummary.byVerdict.other}** |

### Raw disqualification reason strings (top)

${Object.entries(screenSummary.rawReasonCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)
  .map(([k, v]) => `- \`${k}\`: ${v}`)
  .join('\n')}

## 2. Unknown-lane ways × qualified routes

- Qualified route × unknown-way pairs **before geometry gates** (route passed labelled-way screen; all indexed coverage rows on that route): **${qualifiedRouteUnknownWayPairsBeforeGeometryGates.length}**
- Of those, pairs reaching pose minimum and geometry evaluation (future_geometry or not_geometry_eligible): **${qualifiedPairsPassingPoseMinBeforeGeometryGate.length}**
- Qualified route × unknown-way pairs **after geometry gates** (\`future_geometry_candidate\` only): **${futurePairs.length}**
- Unknown-lane OSM ways with **≥1** post-gate future-geometry pair: **${waysWithQualifiedCoverage.size}** / **${coverage.unknown_lane_ways_with_coverage}** with any coverage
- Total indexed pairs (any route qualification): **${pairs.length}**

### Pair status counts (all indexed pairs)

${Object.entries(countPairStatuses(pairs))
  .map(([k, v]) => `- \`${k}\`: **${v}**`)
  .join('\n')}

## 3. Top 20 pairs

Ranking uses route qualification (must pass labelled-way screen), then \`shortlist_ranking_score\` from matched poses, heading/distance quality, direction-compatible fraction, and continuous covered length (geometry gates for straight/non-junction eligibility).

See \`top_20_future_geometry_pairs.md\`.

## 4. Target ways

### Jalan Kamuning (${TARGET_WAYS.JALAN_KAMUNING})

- OSM lane status: \`${summary.target_ways.jalan_kamuning_39914067.osm_lane_status}\`
- Covering **qualified** routes: **${summary.target_ways.jalan_kamuning_39914067.covering_qualified_route_count}**
- Best evidence: ${summary.target_ways.jalan_kamuning_39914067.best_qualified_route_evidence ? `route **${summary.target_ways.jalan_kamuning_39914067.best_qualified_route_evidence.route_ref}**, ${summary.target_ways.jalan_kamuning_39914067.best_qualified_route_evidence.matched_pose_count} matched poses` : '_none_'}
- Final status: **${summary.target_ways.jalan_kamuning_39914067.final_status}**
- **Lane count inferred:** no (\`selected_lane_count\` remains null)

### Lorong Kuda (${TARGET_WAYS.LORONG_KUDA})

- OSM lane status: \`${summary.target_ways.lorong_kuda_706737045.osm_lane_status}\`
- Covering **qualified** routes: **${summary.target_ways.lorong_kuda_706737045.covering_qualified_route_count}**
- Best evidence: ${summary.target_ways.lorong_kuda_706737045.best_qualified_route_evidence ? `route **${summary.target_ways.lorong_kuda_706737045.best_qualified_route_evidence.route_ref}**` : '_none in coverage index_'}
- Final status: **${summary.target_ways.lorong_kuda_706737045.final_status}**
- **Lane count inferred:** no

## 5. Conclusion

${summary.conclusion}

---

_Validated against completed \`phase3-route-qualification.json\` and Phase 2 \`discovery-progress.json\` way rows. No Maps Read fetches. No cross-route prototype pooling._
`;

  const top20Md = `# Top 20 future-geometry route × unknown-way pairs

${FUTURE_GEOMETRY_PAIR_DISCLAIMER}

${SHORTLIST_NOT_OSM_ENRICHMENT}

| # | Route | Way (redacted) | Poses | Cont. length (m) | Med. dist (m) | Med. heading (°) | Dir. frac | Score |
|---|-------|----------------|------:|-----------------:|--------------:|-----------------:|--------:|------:|
${top20
  .map((p, i) => {
    const r = redactPairRow(p);
    return `| ${i + 1} | ${r.route_ref} | ${r.osm_way_id_redacted} | ${r.matched_pose_count} | ${r.continuous_covered_length_m?.toFixed?.(1) ?? ''} | ${r.median_distance_m?.toFixed?.(2) ?? ''} | ${r.median_heading_diff_deg?.toFixed?.(1) ?? ''} | ${r.direction_compatible_fraction?.toFixed?.(2) ?? ''} | ${r.shortlist_ranking_score?.toFixed?.(2) ?? ''} |`;
  })
  .join('\n')}

## Notes

${top20MdRows.map((line) => `- ${line}`).join('\n')}
`;

  return {
    reportDir,
    summary,
    shortlistRedacted,
    md,
    top20Md,
    top20,
    futurePairs,
    validation,
  };
}

function countPairStatuses(pairs) {
  const counts = {};
  for (const s of Object.values(PAIR_SHORTLIST_STATUS)) counts[s] = 0;
  for (const p of pairs) counts[p.shortlist_status] = (counts[p.shortlist_status] || 0) + 1;
  return counts;
}

export function writeFinalPhase3Results(artifacts) {
  const dir = artifacts.reportDir;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'final_phase3_summary.json'), `${JSON.stringify(artifacts.summary, null, 2)}\n`);
  fs.writeFileSync(
    path.join(dir, 'qualified_route_unknown_way_shortlist.redacted.json'),
    `${JSON.stringify(artifacts.shortlistRedacted, null, 2)}\n`
  );
  fs.writeFileSync(path.join(dir, 'FINAL_PHASE3_RESULTS.md'), artifacts.md);
  fs.writeFileSync(path.join(dir, 'top_20_future_geometry_pairs.md'), artifacts.top20Md);
}

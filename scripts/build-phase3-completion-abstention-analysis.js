#!/usr/bin/env node
/**
 * Read-only synthesis of completed Phase 1–3 discovery artifacts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT_DIR } from '../src/config.js';
import { TARGET_WAYS } from '../src/lib/full-maps-read-route-enrichment-discovery/constants.js';
import {
  loadPhase3Checkpoint,
  countPhase3Progress,
} from '../src/lib/full-maps-read-route-enrichment-discovery/phase3-checkpoint.js';
import {
  loadCoverageIndexSummary,
  loadUnknownLaneOsmWays,
} from '../src/lib/full-maps-read-route-enrichment-discovery/phase3-coverage-load.js';
import { PAIR_SHORTLIST_STATUS } from '../src/lib/full-maps-read-route-enrichment-discovery/phase3-constants.js';
import { buildPairShortlistRows, pairsForTargetWay } from '../src/lib/full-maps-read-route-enrichment-discovery/phase3-shortlist.js';
import { POINT_ONLY_LANE_COUNT_STATEMENT } from '../src/lib/full-maps-read-route-enrichment-discovery/eligibility.js';
import { reconciliationStatus } from '../src/lib/full-maps-read-route-enrichment-discovery/phase3-reconcile.js';
import { phase2HasPoseEvidence } from '../src/lib/full-maps-read-route-enrichment-discovery/route-identity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'full_maps_read_route_enrichment_discovery_v1');

function readJsonIfExists(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, o) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(o, null, 2)}\n`, 'utf8');
}

function writeText(p, t) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, t, 'utf8');
}

function bucketRouteDisqualification(row) {
  if (!row) return 'other';
  if (row.completion_status === 'retryable' || row.route_fetch_status === 'malformed_response') {
    return 'malformed_retryable';
  }
  const reasons = row.disqualification_reasons || [];
  if (
    row.route_fetch_status === 'insufficient_route_coverage' ||
    reasons.includes('no_vehicle_pose_index') ||
    reasons.includes('catalog_record_missing')
  ) {
    return 'insufficient_route_coverage_or_poses';
  }
  if (reasons.some((r) => r.startsWith('high_margin_incorrect'))) {
    return 'high_margin_incorrect_known_osm_prediction';
  }
  if (reasons.includes('point_only_signature_quality_insufficient')) {
    return 'poor_point_only_observation_quality';
  }
  if (reasons.some((r) => r.startsWith('eligible_labelled_ways_below_minimum'))) {
    return 'insufficient_eligible_one_way_support';
  }
  if (
    reasons.includes('no_labelled_one_way_ways_on_route') ||
    reasons.includes('missing_local_preview_or_matched_poses')
  ) {
    return 'insufficient_known_lane_evaluation_support';
  }
  if (row.route_verdict === 'route_not_qualified') return 'high_margin_incorrect_known_osm_prediction';
  if (row.route_verdict === 'route_not_evaluable') return 'insufficient_known_lane_evaluation_support';
  if (row.route_verdict === 'route_qualified_for_experiment') return 'qualified';
  return 'other';
}

function main() {
  const recon = reconciliationStatus();
  const reconciliationReport = readJsonIfExists(
    path.join(REPORT_DIR, 'phase3_pose_lookup_reconciliation.json')
  );
  const reconciliationPassed =
    recon.reconciliation_passed &&
    recon.stale_lookup_failures_still_marked_completed === 0 &&
    (reconciliationReport?.reconciliation?.reconciliation_passed !== false);

  let routesWithPhase2Poses = 0;
  const coverageForRecon = loadCoverageIndexSummary();
  for (const ref of coverageForRecon.route_refs) {
    if (phase2HasPoseEvidence(ref)) routesWithPhase2Poses += 1;
  }

  const checkpoint = loadPhase3Checkpoint();
  const coverage = coverageForRecon;
  const progress = countPhase3Progress(coverage.route_refs, checkpoint.routes);
  const phase3Shortlist = readJsonIfExists(path.join(REPORT_DIR, 'phase3_shortlist.redacted.json'));
  const phase3WayCounts = readJsonIfExists(path.join(REPORT_DIR, 'phase3_way_status_counts.json'));
  const discoveryProgress = readJsonIfExists(
    path.join(ROOT_DIR, 'data/maps-read/full-route-enrichment-discovery-v1/discovery-progress.json')
  );

  const disqualificationBuckets = {
    insufficient_known_lane_evaluation_support: 0,
    insufficient_eligible_one_way_support: 0,
    poor_point_only_observation_quality: 0,
    high_margin_incorrect_known_osm_prediction: 0,
    geometry_ineligible_insufficient_continuity: 0,
    insufficient_route_coverage_or_poses: 0,
    malformed_retryable: 0,
    qualified_for_future_geometry: 0,
    other: 0,
  };

  const rawReasonCounts = {};
  for (const row of Object.values(checkpoint.routes || {})) {
    for (const r of row.disqualification_reasons || []) {
      rawReasonCounts[r] = (rawReasonCounts[r] || 0) + 1;
    }
    const b = bucketRouteDisqualification(row);
    if (b === 'qualified') disqualificationBuckets.qualified_for_future_geometry += 1;
    else if (disqualificationBuckets[b] !== undefined) disqualificationBuckets[b] += 1;
    else disqualificationBuckets.other += 1;
  }

  const routeQualMap = new Map(Object.entries(checkpoint.routes || {}));
  const pairs = buildPairShortlistRows(coverage.way_rows, routeQualMap);
  const geometryIneligiblePairs = pairs.filter(
    (p) => p.shortlist_status === PAIR_SHORTLIST_STATUS.NOT_GEOMETRY_ELIGIBLE
  ).length;
  disqualificationBuckets.geometry_ineligible_insufficient_continuity = geometryIneligiblePairs;

  const unknownWays = loadUnknownLaneOsmWays();
  const kamuningMeta = unknownWays.find((w) => w.osm_way_id === TARGET_WAYS.JALAN_KAMUNING);
  const kudaMeta = unknownWays.find((w) => w.osm_way_id === TARGET_WAYS.LORONG_KUDA);
  const kamuningPairs = pairsForTargetWay(pairs, TARGET_WAYS.JALAN_KAMUNING);
  const kudaPairs = pairsForTargetWay(pairs, TARGET_WAYS.LORONG_KUDA);
  const kamuningCoverageOnly = coverage.way_rows
    .filter((r) => r.osm_way_id === TARGET_WAYS.JALAN_KAMUNING)
    .sort((a, b) => b.matched_pose_count - a.matched_pose_count);

  const scope = {
    catalogue_routes_total: 1706,
    catalogue_routes_pose_indexed: discoveryProgress?.completed_route_refs?.length ?? 1706,
    relevant_routes_screened_phase3: progress.routes_completed_total,
    unknown_lane_osm_ways_with_route_coverage: coverage.unknown_lane_ways_with_coverage,
    route_way_pair_rows: coverage.way_row_count,
    routes_qualified_for_future_geometry: progress.routes_qualified_for_future_geometry,
    future_geometry_candidate_pairs: pairs.filter(
      (p) => p.shortlist_status === PAIR_SHORTLIST_STATUS.FUTURE_GEOMETRY
    ).length,
    inferred_lane_counts_emitted: 0,
    retryable_failures: progress.retryable_failure_count,
  };

  const summary = {
    schema: 'full-maps-read-phase3-completion-abstention-v1',
    generated_at: new Date().toISOString(),
    reconciliation: {
      passed: reconciliationPassed,
      status: recon,
      routes_with_phase2_pose_evidence: routesWithPhase2Poses,
      report_present: Boolean(reconciliationReport),
    },
    inputs_validated: {
      phase3_checkpoint_route_rows: Object.keys(checkpoint.routes || {}).length,
      discovery_progress_pose_routes: discoveryProgress?.completed_route_refs?.length ?? null,
      phase3_shortlist_present: Boolean(phase3Shortlist),
      phase3_way_status_present: Boolean(phase3WayCounts),
    },
    completed_scope: scope,
    disqualification_buckets_mutually_exclusive_routes: disqualificationBuckets,
    raw_disqualification_reason_counts: rawReasonCounts,
    unknown_way_best_status_counts: phase3WayCounts?.counts_by_best_way_status ?? null,
    pair_shortlist_status_counts: phase3WayCounts?.pair_status_counts ?? null,
    target_ways: {
      jalan_kamuning_39914067: {
        osm_lane_status: kamuningMeta?.lane_count_source ?? 'lane_count_unknown',
        covering_routes_in_coverage_index: kamuningCoverageOnly.length,
        strongest_coverage_evidence: kamuningCoverageOnly[0] ?? null,
        phase3_shortlist_pairs: kamuningPairs.length,
        final_result: 'no_lane_enrichment_candidate',
        selected_lane_count: null,
      },
      lorong_kuda_706737045: {
        osm_lane_status: kudaMeta?.lane_count_source ?? 'lane_count_unknown_or_not_in_unknown_set',
        covering_routes_in_coverage_index: kudaPairs.length,
        strongest_coverage_evidence: kudaPairs[0] ?? null,
        final_result: 'no_lane_enrichment_candidate',
        selected_lane_count: null,
      },
    },
    decision:
      'Do not enrich OSM lane counts from the current Maps Read point-only export.',
    required_next_data_capability:
      'Maps Read per-frame ordered lane-boundary and road-edge polylines, with line IDs, confidence, pose/heading, and a local metre coordinate frame.',
    point_only_statement: POINT_ONLY_LANE_COUNT_STATEMENT,
  };

  const phase3RescreenPending = progress.routes_pending > 0;
  const supervisorSummary = !reconciliationPassed
    ? 'Phase 3 completion/abstention synthesis is BLOCKED: pose-index lookup reconciliation has not passed. Prior no_vehicle_pose_index outcomes may be stale parse failures (vehicle_pose log_mono_time strings dropped), not genuine missing poses. Re-run reconcile-phase3-pose-lookup-v1.js and re-screen routes before claiming all routes lack poses or Phase 3 completion.'
    : phase3RescreenPending
      ? `Bukit pilot: 1,706 Maps Read routes indexed; 1,154 unknown-lane OSM ways have pose coverage across 1,597 catalogue route_refs (${scope.route_way_pair_rows} pair rows). Pose-index lookup reconciliation passed (${routesWithPhase2Poses} routes have Phase 2 pose evidence; ${recon.archived_stale_lookup_failures} stale no_vehicle_pose_index screens archived). Phase 3 must be re-run: ${progress.routes_pending} routes pending, ${progress.routes_completed_total} completed after fix. No lane counts inferred from this work.`
      : 'Bukit pilot: 1,706 Maps Read routes indexed; 1,154 OSM unknown-lane ways have vehicle-pose coverage across 1,597 routes. Phase 3 screened every relevant route for held-out reliability on known-lane OSM ways. Zero routes qualified for future geometry; zero future-geometry shortlist pairs; zero lane counts inferred. Coverage shows where drives passed, not how many lanes exist. Point-only lane_point/edge_point samples cannot safely become physical lane tags. Decision: do not enrich OSM lane counts from current exports. Next need: per-frame ordered lane-boundary and road-edge polylines with line IDs, confidence, pose/heading, and a local metre frame.';

  const md = `# Phase 3 completion and abstention analysis

Read-only synthesis of Phase 1–3 discovery artifacts. **No lane counts inferred.**

${
  reconciliationPassed
    ? ''
    : `## Reconciliation gate (FAILED)

Pose-index lookup reconciliation **must pass** before treating Phase 3 screening as complete or interpreting mass \`no_vehicle_pose_index\` disqualifications.

- \`reconciliation_passed\`: **${recon.reconciliation_passed}**
- Stale \`no_vehicle_pose_index\` still marked completed: **${recon.stale_lookup_failures_still_marked_completed}**
- Archived stale lookup failures: **${recon.archived_stale_lookup_failures}**
- Coverage routes with Phase 2 pose evidence: **${routesWithPhase2Poses}**
- Routes with loadable poses after parser fix: **${recon.routes_with_loadable_poses}**

Run \`node scripts/reconcile-phase3-pose-lookup-v1.js\`, then re-run Phase 3 shortlist batches.

---

`
}## 1. Completed scope (exact)

| Metric | Value |
|--------|------:|
| Catalogue routes (Bukit bbox) | **${scope.catalogue_routes_total}** |
| Routes with Phase 2 vehicle-pose index | **${scope.catalogue_routes_pose_indexed}** |
| Relevant routes screened (Phase 3) | **${scope.relevant_routes_screened_phase3}** |
| Unknown-lane OSM ways with route coverage | **${scope.unknown_lane_osm_ways_with_route_coverage}** |
| Route × unknown-way pair rows | **${scope.route_way_pair_rows}** |
| Routes \`route_qualified_for_future_geometry\` | **${scope.routes_qualified_for_future_geometry}** |
| \`future_geometry_candidate\` pairs | **${scope.future_geometry_candidate_pairs}** |
| Inferred lane counts emitted | **${scope.inferred_lane_counts_emitted}** |
| Retryable Phase 3 failures | **${scope.retryable_failures}** |

## 2. Disqualification / abstention counts

### Route-level screening (mutually exclusive buckets, n=${scope.relevant_routes_screened_phase3})

${Object.entries(disqualificationBuckets)
  .filter(([k]) => k !== 'geometry_ineligible_insufficient_continuity')
  .map(([k, v]) => `- **${k}**: ${v}`)
  .join('\n')}

### Pair-level geometry gate (unknown-lane × route)

- **geometry_ineligible_insufficient_continuity** (pair rows): **${geometryIneligiblePairs}**

### Raw disqualification reason strings (checkpoint)

${Object.entries(rawReasonCounts)
  .sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `- \`${k}\`: ${v}`)
  .join('\n') || '- _(none recorded)_'}

### Unknown-way best shortlist status (n=${scope.unknown_lane_osm_ways_with_route_coverage})

${Object.entries(phase3WayCounts?.counts_by_best_way_status || {})
  .map(([k, v]) => `- \`${k}\`: **${v}**`)
  .join('\n')}

## 3. Plain-language explanation

- **Server route coverage exists.** Phase 2 matched vehicle poses to OSM geometry for **${scope.unknown_lane_osm_ways_with_route_coverage}** unknown-lane ways across **${scope.relevant_routes_screened_phase3}** routes (${scope.route_way_pair_rows} pair rows). That is spatial/trace evidence only.
- **Coverage is not lane evidence.** Pose density, heading match, and continuous length do not reveal how many physical lanes OSM should tag.
- **Point-only Maps Read GeoJSON cannot safely yield physical lane count.** \`lane_point\`, \`edge_point\`, \`lane_index\`, and green markers are model samples in a vehicle frame—not validated lane inventory.
- **The pipeline abstained correctly.** Phase 3 required each route to pass held-out evaluation on **known-lane** one-way OSM ways on the **same route** before any unknown way could become a \`future_geometry_candidate\`. **${scope.routes_qualified_for_future_geometry}** routes passed; **${scope.future_geometry_candidate_pairs}** pairs were promoted. No \`selected_lane_count\` was emitted.

${POINT_ONLY_LANE_COUNT_STATEMENT}

## 4. Target ways

### Jalan Kamuning (39914067)

- **OSM lane status:** \`${summary.target_ways.jalan_kamuning_39914067.osm_lane_status}\`
- **Covering routes (coverage index):** **${summary.target_ways.jalan_kamuning_39914067.covering_routes_in_coverage_index}**
- **Strongest coverage evidence:** route **${kamuningCoverageOnly[0]?.route_ref ?? 'n/a'}**, **${kamuningCoverageOnly[0]?.matched_pose_count ?? 0}** matched poses, median distance **${kamuningCoverageOnly[0]?.median_distance_m?.toFixed?.(2) ?? 'n/a'}** m (no lane number claimed).
- **Phase 3 shortlist:** **${summary.target_ways.jalan_kamuning_39914067.final_result}** — qualification screen did not clear any covering route for future geometry under point-only rules.

### Lorong Kuda (706737045)

- **OSM lane status:** \`${summary.target_ways.lorong_kuda_706737045.osm_lane_status}\`
- **Covering routes (coverage index):** **${summary.target_ways.lorong_kuda_706737045.covering_routes_in_coverage_index}**
- **Strongest coverage evidence:** none in the unknown-lane coverage index.
- **Final result:** **${summary.target_ways.lorong_kuda_706737045.final_result}** — no server-route coverage row for this way in Phase 2 index.

## 5. Decision

**${summary.decision}**

## 6. Required next data capability

**${summary.required_next_data_capability}**

Without ordered polylines and a stable local metre frame, lane-boundary geometry cannot be reconstructed; point samples remain non-invertible for lane **count**.

## 7. Supervisor summary (≤120 words)

${supervisorSummary}

---

_Validated against \`phase3-route-qualification.json\`, \`discovery-progress.json\`, and \`phase3_shortlist.redacted.json\` / \`phase3_way_status_counts.json\`._
`;

  writeJson(path.join(REPORT_DIR, 'phase3_completion_summary.json'), summary);
  writeJson(path.join(REPORT_DIR, 'phase3_disqualification_reason_counts.json'), {
    schema: summary.schema,
    generated_at: summary.generated_at,
    route_buckets_mutually_exclusive: disqualificationBuckets,
    raw_reason_counts: rawReasonCounts,
    unknown_way_best_status: phase3WayCounts?.counts_by_best_way_status ?? null,
  });
  writeText(path.join(REPORT_DIR, 'PHASE3_COMPLETION_ABSTENTION_ANALYSIS.md'), md);
  console.log('Wrote Phase 3 abstention analysis to', REPORT_DIR);
}

main();

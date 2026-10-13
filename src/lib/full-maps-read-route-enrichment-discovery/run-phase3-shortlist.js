import fs from 'node:fs';
import { roadIndexPath } from '../lane-baseline-paths.js';
import { DEFAULT_LOCAL_AREA_ID } from '../local-areas.js';
import { emptyGeoJsonParseStats } from './parse-maps-read-geojson.js';
import { qualifyCatalogRoute } from './qualify-routes.js';
import {
  PHASE3_VERSION,
  PHASE3_BATCH,
  PAIR_SHORTLIST_STATUS,
  SHORTLIST_NOT_OSM_ENRICHMENT,
  resolvePhase3CheckpointPath,
} from './phase3-constants.js';
import {
  loadPhase3Checkpoint,
  persistPhase3RouteResult,
  selectPhase3Batch,
  countPhase3Progress,
} from './phase3-checkpoint.js';
import { reconcilePhase3StaleLookupFailures } from './phase3-reconcile.js';
import {
  loadCoverageIndexSummary,
  loadCachedCatalogRecordByRef,
  loadPosesForRouteRef,
  targetWayIds,
} from './phase3-coverage-load.js';
import {
  buildPairShortlistRows,
  aggregateWayShortlistStatuses,
  topFutureGeometryCandidates,
  pairsForTargetWay,
  POINT_ONLY_LANE_COUNT_STATEMENT,
} from './phase3-shortlist.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runPhase3UnknownLaneShortlist({
  token,
  checkpointPath = resolvePhase3CheckpointPath(),
  reconcileStale = true,
}) {
  if (reconcileStale) {
    reconcilePhase3StaleLookupFailures(checkpointPath);
  }
  const coverage = loadCoverageIndexSummary();
  const { recordByRef } = loadCachedCatalogRecordByRef();
  const checkpoint = loadPhase3Checkpoint(checkpointPath);
  const routesByRef = checkpoint.routes || {};
  const parseStats = emptyGeoJsonParseStats();
  const serverRequests = [];

  const routesNeeded = coverage.route_refs;
  const perRun = PHASE3_BATCH.routesPerRun ?? PHASE3_BATCH.defaultRoutesPerRun;
  const beforeProgress = countPhase3Progress(routesNeeded, routesByRef);
  const { pending, batch } = selectPhase3Batch(routesNeeded, routesByRef, perRun);

  const roadIndex = JSON.parse(fs.readFileSync(roadIndexPath(DEFAULT_LOCAL_AREA_ID), 'utf8'));

  for (const routeRef of batch) {
    await sleep(PHASE3_BATCH.interRouteDelayMs);
    const record = recordByRef.get(routeRef);
    if (!record) {
      persistPhase3RouteResult(
        checkpoint,
        routeRef,
        {
          route_fetch_status: 'insufficient_route_coverage',
          route_verdict: null,
          labelled_ways_on_route: 0,
          eligible_labelled_ways: 0,
          disqualification_reasons: ['catalog_record_missing'],
          unknown_road_lane_count_emitted: false,
        },
        checkpointPath
      );
      continue;
    }
    const poses = loadPosesForRouteRef(routeRef, parseStats);
    if (!poses.length) {
      persistPhase3RouteResult(
        checkpoint,
        routeRef,
        {
          route_fetch_status: 'insufficient_route_coverage',
          route_verdict: null,
          labelled_ways_on_route: 0,
          eligible_labelled_ways: 0,
          disqualification_reasons: ['no_vehicle_pose_index'],
          unknown_road_lane_count_emitted: false,
        },
        checkpointPath
      );
      continue;
    }
    const row = await qualifyCatalogRoute({
      routeRef,
      record,
      poses,
      token,
      serverRequests,
      runParseStats: parseStats,
      roadIndex,
    });
    persistPhase3RouteResult(checkpoint, routeRef, row, checkpointPath);
  }

  const routeQualByRef = new Map(Object.entries(checkpoint.routes || {}));
  const pairs = buildPairShortlistRows(coverage.way_rows, routeQualByRef);
  const wayAgg = aggregateWayShortlistStatuses(pairs, coverage.unknown_way_ids_with_coverage);
  const top20 = topFutureGeometryCandidates(pairs, 20);
  const targets = targetWayIds();
  const afterProgress = countPhase3Progress(routesNeeded, checkpoint.routes);

  return {
    version: PHASE3_VERSION,
    checkpoint_path: checkpointPath,
    coverage_summary: {
      catalog_routes_indexed: 1706,
      unknown_lane_ways_with_coverage: coverage.unknown_lane_ways_with_coverage,
      way_row_pairs: coverage.way_row_count,
      distinct_routes_in_coverage: coverage.route_ref_count,
    },
    qualification_progress: {
      ...afterProgress,
      batch_processed_this_run: batch.length,
      batch_first_route_id: batch[0] ?? null,
      batch_last_route_id: batch.length ? batch[batch.length - 1] : null,
      before_run: beforeProgress,
      after_run: afterProgress,
    },
    geojson_parse_stats: parseStats,
    way_status_counts: wayAgg.status_counts,
    pair_status_counts: countPairStatuses(pairs),
    top_future_geometry_candidates: top20,
    target_ways: {
      jalan_kamuning_39914067: pairsForTargetWay(pairs, targets.jalan_kamuning),
      lorong_kuda_706737045: pairsForTargetWay(pairs, targets.lorong_kuda),
    },
    pairs_total: pairs.length,
    shortlist_statement: SHORTLIST_NOT_OSM_ENRICHMENT,
    point_only_statement: POINT_ONLY_LANE_COUNT_STATEMENT,
    next_single_action:
      afterProgress.routes_pending > 0
        ? `Re-run phase 3 to qualify remaining ${afterProgress.routes_pending} routes: node scripts/run-full-maps-read-phase3-unknown-lane-shortlist-v1.js`
        : 'Phase 3 route qualification complete; review top_future_geometry_candidates (no OSM lane writes).',
    redacted_pairs_sample: pairs.slice(0, 500).map((p) => ({
      ...p,
      osm_way_id: `way-${String(p.osm_way_id).slice(-6)}`,
    })),
  };
}

function countPairStatuses(pairs) {
  const counts = {};
  for (const s of Object.values(PAIR_SHORTLIST_STATUS)) counts[s] = 0;
  for (const p of pairs) counts[p.shortlist_status] = (counts[p.shortlist_status] || 0) + 1;
  return counts;
}

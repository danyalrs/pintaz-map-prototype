import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { verifyProtectedInputHashes, readGitHead } from '../multi-drive-rebuild-guard.js';
import { routeSortKey } from '../bukit-route-redaction.js';
import { redactDongle } from '../update-preview-prepare.js';
import {
  DISCOVERY_VERSION,
  DATA_DIR,
  CHECKPOINT_DIR,
  TARGET_WAYS,
  WAY_COVERAGE_CLASS,
  QUALIFICATION,
} from './constants.js';
import { loadUnknownLaneOsmWays } from './missing-lane-ways.js';
import { fetchFullRouteCatalog } from './routes-catalog.js';
import { fetchVehiclePosesForRoute, loadVehiclePosesFromRaw } from './fetch-vehicle-poses.js';
import {
  summarizeRoutePoseMatches,
  classifyWayCoverage,
  rankRouteRoadPairs,
} from './coverage-index.js';
import { qualifyTopRoutes } from './qualify-routes.js';
import { ROUTE_VERDICT } from '../route-aware-lane-calibration-audit/constants.js';
import {
  emptyGeoJsonParseStats,
  mergeGeoJsonParseStats,
} from './parse-maps-read-geojson.js';
import { POINT_ONLY_LANE_COUNT_STATEMENT } from './eligibility.js';

function writeJson(p, o) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(o, null, 2)}\n`, 'utf8');
}

export async function runFullMapsReadRouteEnrichmentDiscovery({ token, liveApiOnly = false } = {}) {
  const head = readGitHead(process.cwd());
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  const porcelain = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
  const protected_hashes = verifyProtectedInputHashes(process.cwd());

  fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  writeJson(path.join(CHECKPOINT_DIR, 'phase0.json'), {
    head,
    branch,
    porcelain_lines: porcelain.split('\n').filter(Boolean).length,
    protected_hashes: {
      ok: protected_hashes.ok === true,
      mismatches: protected_hashes.mismatches ?? [],
    },
    untracked_files_note: 'see git status --porcelain',
    maps_read_token_configured: Boolean(token),
    token_logged: false,
  });

  const serverRequests = [];
  const catalog = await fetchFullRouteCatalog(token);
  serverRequests.push(...catalog.serverRequests);
  if (!catalog.total_records) {
    throw new Error(`route_catalog_empty: stop=${catalog.stopReason ?? 'unknown'}`);
  }

  const unknownWays = loadUnknownLaneOsmWays();
  const unknownIds = unknownWays.map((w) => w.osm_way_id);

  const maxRoutes = Number(process.env.FULL_DISCOVERY_MAX_ROUTES || '0') || catalog.records.length;
  const records = catalog.records.slice(0, maxRoutes);
  const recordByRef = new Map();
  for (const r of records) {
    const ref = catalog.refMap.get(routeSortKey(r));
    recordByRef.set(ref, r);
  }

  const apiState = { liveDisabled: false };
  const geoParseStats = emptyGeoJsonParseStats();
  const retryableMalformedRouteRefs = [];
  const progressPath = path.join(DATA_DIR, 'discovery-progress.json');
  let progress = fs.existsSync(progressPath)
    ? JSON.parse(fs.readFileSync(progressPath, 'utf8'))
    : { completed_route_refs: [], way_rows: [] };
  const completedSet = new Set(progress.completed_route_refs || []);
  const allRouteWayRows = [...(progress.way_rows || [])];
  let poseRoutesOk = progress.completed_route_refs?.length || 0;
  for (const r of records) {
    const routeRef = catalog.refMap.get(routeSortKey(r));
    if (completedSet.has(routeRef)) continue;
    const fetched = await fetchVehiclePosesForRoute({
      routeRef,
      dongle: r.dongle,
      route: r.route,
      token,
      serverRequests,
      apiState,
      liveApiOnly,
      runParseStats: geoParseStats,
    });
    mergeGeoJsonParseStats(geoParseStats, fetched.parseStats);
    if (fetched.route_fetch_status === 'malformed_response') {
      retryableMalformedRouteRefs.push(routeRef);
      continue;
    }
    let poses = fetched.poses;
    if (!poses?.length) poses = loadVehiclePosesFromRaw(routeRef);
    if (!poses?.length) continue;
    poseRoutesOk += 1;
    const { wayRows } = summarizeRoutePoseMatches(poses, unknownIds);
    for (const w of wayRows) {
      allRouteWayRows.push({
        route_ref: routeRef,
        dongle_ref: redactDongle(r.dongle),
        ...w,
        coverage_class: classifyWayCoverage(w),
      });
    }
    completedSet.add(routeRef);
    progress = {
      completed_route_refs: [...completedSet],
      way_rows: allRouteWayRows,
      updated_at: new Date().toISOString(),
    };
    writeJson(progressPath, progress);
  }

  const rankedPairs = rankRouteRoadPairs(allRouteWayRows);

  const wayAggregation = new Map();
  for (const w of unknownWays) {
    wayAggregation.set(w.osm_way_id, {
      ...w,
      route_observations: [],
      coverage_class: WAY_COVERAGE_CLASS.NONE,
    });
  }
  for (const row of rankedPairs) {
    const agg = wayAggregation.get(row.osm_way_id);
    if (!agg) continue;
    agg.route_observations.push({
      route_ref: row.route_ref,
      dongle_ref: row.dongle_ref,
      matched_pose_count: row.matched_pose_count,
      median_distance_m: row.median_distance_m,
      median_heading_diff_deg: row.median_heading_diff_deg,
      direction_compatible_fraction: row.direction_compatible_fraction,
      continuous_covered_length_m: row.continuous_covered_length_m,
      coverage_class: row.coverage_class,
      ranking_score: row.ranking_score,
    });
    const classes = agg.route_observations.map((o) => o.coverage_class);
    if (classes.includes(WAY_COVERAGE_CLASS.RANKED)) agg.coverage_class = WAY_COVERAGE_CLASS.RANKED;
    else if (classes.includes(WAY_COVERAGE_CLASS.CANDIDATE)) agg.coverage_class = WAY_COVERAGE_CLASS.CANDIDATE;
    else if (classes.includes(WAY_COVERAGE_CLASS.LOW)) agg.coverage_class = WAY_COVERAGE_CLASS.LOW;
  }

  const routeScores = new Map();
  for (const row of rankedPairs) {
    routeScores.set(row.route_ref, (routeScores.get(row.route_ref) || 0) + row.ranking_score);
  }
  const topRouteRefs = [...routeScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, QUALIFICATION.maxRoutesToQualify)
    .map(([ref]) => ref);

  const posesByRef = new Map();
  for (const ref of topRouteRefs) {
    posesByRef.set(ref, loadVehiclePosesFromRaw(ref));
  }

  const { results: qualification, parseStats: qualificationParseStats } = await qualifyTopRoutes({
    topRouteRefs,
    recordByRef,
    posesByRef,
    token,
    serverRequests,
    runParseStats: geoParseStats,
  });
  mergeGeoJsonParseStats(geoParseStats, qualificationParseStats);
  for (const q of qualification) {
    if (q.route_fetch_status === 'malformed_response' && q.retryable) {
      retryableMalformedRouteRefs.push(q.route_ref);
    }
  }

  const anyQualified = qualification.some((q) => q.route_verdict === ROUTE_VERDICT.QUALIFIED);
  const waysWithCoverage = [...wayAggregation.values()].filter((w) => w.route_observations.length > 0);

  const qualByRef = new Map(qualification.map((q) => [q.route_ref, q.route_verdict]));
  const attachQualVerdicts = (agg) => {
    if (!agg) return null;
    return {
      ...agg,
      route_observations: agg.route_observations.map((o) => ({
        ...o,
        route_qualification_verdict: qualByRef.get(o.route_ref) ?? 'not_in_qualification_set',
      })),
    };
  };
  const targetRows = {
    jalan_kamuning_39914067: attachQualVerdicts(wayAggregation.get(TARGET_WAYS.JALAN_KAMUNING)),
    lorong_kuda_706737045: attachQualVerdicts(wayAggregation.get(TARGET_WAYS.LORONG_KUDA)),
  };

  return {
    version: DISCOVERY_VERSION,
    maps_read_host_status: apiState.liveDisabled ? 'live_geojson_unavailable_502' : 'live_ok_or_unused',
    phase0: { head, branch, protected_hashes_ok: protected_hashes.ok === true },
    catalog: {
      total_server_routes: catalog.total_records,
      pagination_stop_reason: catalog.stopReason,
      page_count: catalog.page_count,
      redacted_catalog: catalog.redactedCatalog,
    },
    unknown_lane_way_count: unknownWays.length,
    unknown_lane_ways_with_server_coverage: waysWithCoverage.length,
    pose_index_routes_processed: poseRoutesOk,
    ranked_pairs_count: rankedPairs.length,
    top_route_refs: topRouteRefs,
    target_way_rows: targetRows,
    qualification,
    lane_enrichment_candidate_permitted: anyQualified,
    lane_enrichment_note: anyQualified
      ? 'No production OSM candidate — only experimental qualification on held-out labelled ways per route.'
      : 'No server route passed held-out point-only qualification on labelled OSM ways; no lane-count enrichment candidate is permitted.',
    geojson_parse_summary: {
      ...geoParseStats,
      malformed_retryable_route_refs: [...new Set(retryableMalformedRouteRefs)].sort(),
      invalid_values_never_lane_or_pose_evidence: true,
      point_only_statement: POINT_ONLY_LANE_COUNT_STATEMENT,
    },
    redacted: {
      route_catalog: catalog.redactedCatalog,
      unknown_way_coverage: [...wayAggregation.values()].map((w) => ({
        osm_way_id: `way-${String(w.osm_way_id).slice(-6)}`,
        name: w.name,
        coverage_class: w.coverage_class,
        route_observations: w.route_observations,
      })),
      route_road_ranking: rankedPairs.slice(0, 500).map((r) => ({
        ...r,
        osm_way_id: `way-${String(r.osm_way_id).slice(-6)}`,
      })),
      qualification_results: qualification,
      server_requests: serverRequests,
    },
  };
}

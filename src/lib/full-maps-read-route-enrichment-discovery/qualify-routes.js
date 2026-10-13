import fs from 'node:fs';
import path from 'node:path';
import { MAPS_READ_API_BASE } from '../selected-route-paths.js';
import { curlGetToFile } from '../selected-route-curl.js';
import { redactDongle, redactRoute } from '../update-preview-prepare.js';
import { evaluateRoute } from '../route-aware-lane-calibration-audit/per-route-evaluation.js';
import {
  qualifyRoute,
  attachMultiMetrics,
} from '../route-aware-lane-calibration-audit/qualify-route.js';
import { buildFrameSignature } from '../point-only-lane-signature-calibration/signature.js';
import { isLabelledOneWayRoadIndexEntry } from '../point-only-lane-signature-calibration/corpus.js';
import { roadIndexPath } from '../lane-baseline-paths.js';
import { DEFAULT_LOCAL_AREA_ID } from '../local-areas.js';
import { normalizeOsmWayId } from '../selected-route-osm-comparison-lookup.js';
import { matchVehiclePoses, sortPoses } from '../vehicle-osm-matcher.js';
import { DATA_DIR, POSE_FETCH } from './constants.js';
import { osmMatcherIndex } from './coverage-index.js';
import { buildLocalVehiclePoseSourceMap } from './local-pose-import.js';
import { routeSortKey } from '../bukit-route-redaction.js';
import {
  parseMapsReadGeoJsonFromUtf8,
  mergeGeoJsonParseStats,
  emptyGeoJsonParseStats,
} from './parse-maps-read-geojson.js';

const QUAL_RAW = path.join(DATA_DIR, 'qualification-raw');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readLaneEdgeGeojsonFile(out, runStats) {
  const parsed = parseMapsReadGeoJsonFromUtf8(fs.readFileSync(out, 'utf8'));
  mergeGeoJsonParseStats(runStats, parsed.stats);
  if (!parsed.ok) {
    return {
      malformed: true,
      parseReason: parsed.parseReason,
      stats: parsed.stats,
    };
  }
  const features = (parsed.geojson.features || []).filter(
    (f) => f.properties?.layer === 'lane_point' || f.properties?.layer === 'edge_point'
  );
  return { geojson: { type: 'FeatureCollection', features }, stats: parsed.stats };
}

async function fetchLaneEdgeGeojson({ routeRef, dongle, route, token, serverRequests, runParseStats }) {
  const runStats = runParseStats || emptyGeoJsonParseStats();
  const out = path.join(QUAL_RAW, routeRef, 'lane-edge.geojson');
  if (fs.existsSync(out)) {
    const cached = readLaneEdgeGeojsonFile(out, runStats);
    if (cached.malformed) return cached;
    return { geojson: cached.geojson, stats: runStats };
  }
  const local = buildLocalVehiclePoseSourceMap().get(routeSortKey({ dongle, route }));
  if (local?.geojsonPath && fs.existsSync(local.geojsonPath)) {
    const parsed = parseMapsReadGeoJsonFromUtf8(fs.readFileSync(local.geojsonPath, 'utf8'));
    mergeGeoJsonParseStats(runStats, parsed.stats);
    if (!parsed.ok) {
      return { malformed: true, parseReason: parsed.parseReason, stats: runStats };
    }
    const features = (parsed.geojson.features || []).filter(
      (f) => f.properties?.layer === 'lane_point' || f.properties?.layer === 'edge_point'
    );
    const wrapped = { type: 'FeatureCollection', features };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(wrapped, null, 2)}\n`);
    serverRequests.push({
      method: 'GET',
      path: `/v1/geojson?layers=lane_point,edge_point&route_ref=${routeRef}`,
      status: 200,
      route_ref: routeRef,
      note: 'lane_edge_satisfied_from_local_derived_preview',
      source: local.source,
    });
    return { geojson: wrapped, stats: runStats };
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const url = `${MAPS_READ_API_BASE}/v1/geojson?${new URLSearchParams({
    dongle,
    route,
    layers: 'lane_point,edge_point',
    max_features: '80000',
  }).toString()}`;
  const urlPath = `/v1/geojson?dongle=${redactDongle(dongle)}&route=${redactRoute(route)}&layers=lane_point,edge_point`;
  const part = `${out}.part`;
  const { status } = await curlGetToFile(url, { token, outPath: part, headerPath: `${part}.hdr` });
  serverRequests.push({ method: 'GET', path: urlPath, status, route_ref: routeRef, phase: 'qualification' });
  if (status < 200 || status >= 300) return { geojson: null, stats: runStats };
  const parsed = parseMapsReadGeoJsonFromUtf8(fs.readFileSync(part, 'utf8'));
  mergeGeoJsonParseStats(runStats, parsed.stats);
  if (!parsed.ok) {
    try {
      fs.unlinkSync(part);
    } catch {
      /* ignore */
    }
    return { malformed: true, parseReason: parsed.parseReason, stats: runStats };
  }
  const features = (parsed.geojson.features || []).filter(
    (f) => f.properties?.layer === 'lane_point' || f.properties?.layer === 'edge_point'
  );
  const wrapped = { type: 'FeatureCollection', features };
  fs.writeFileSync(out, `${JSON.stringify(wrapped, null, 2)}\n`);
  try {
    fs.unlinkSync(part);
  } catch {
    /* ignore */
  }
  return { geojson: wrapped, stats: runStats };
}

function buildWaysMapFromServerRoute({ routeRef, poses, laneEdgeFeatures, roadIndex }) {
  const previewByFrame = new Map();
  for (const f of laneEdgeFeatures) {
    const layer = f.properties?.layer;
    if (layer !== 'lane_point' && layer !== 'edge_point') continue;
    const fid = f.properties.frame_id;
    if (!previewByFrame.has(fid)) previewByFrame.set(fid, { lane: [], edge: [] });
    const bucket = layer === 'lane_point' ? 'lane' : 'edge';
    previewByFrame.get(fid)[bucket].push(f.properties);
  }

  const index = osmMatcherIndex();
  const sorted = sortPoses(poses);
  const { matches } = matchVehiclePoses(sorted, index, { searchRadiusM: POSE_FETCH.searchRadiusM });

  const posesByWay = new Map();
  for (const m of matches) {
    const wayId = normalizeOsmWayId(m.properties?.osm_id);
    if (!wayId) continue;
    if (!posesByWay.has(wayId)) posesByWay.set(wayId, []);
    posesByWay.get(wayId).push(m);
  }

  const ways = new Map();
  for (const [wayId, wayMatches] of posesByWay) {
    const entry = roadIndex?.by_osm_id?.[wayId];
    const labelled = isLabelledOneWayRoadIndexEntry(entry);
    const frameIds = [...new Set(wayMatches.map((p) => p.properties.frame_id))];
    const frames = [];
    for (const fid of frameIds) {
      const match = wayMatches.find((p) => p.properties.frame_id === fid);
      const pose = match?.properties;
      const raw = previewByFrame.get(fid) || { lane: [], edge: [] };
      frames.push({
        frame_id: fid,
        route_key: routeRef,
        osm_way_id: wayId,
        osm_lane_count: labelled ? Number(entry.lane_count_total) : null,
        signature: buildFrameSignature({
          pose,
          lanePoints: raw.lane,
          edgePoints: raw.edge,
        }),
      });
    }
    ways.set(wayId, {
      osm_way_id: wayId,
      osm_lane_count: labelled ? Number(entry.lane_count_total) : null,
      labelled_one_way: labelled,
      frames,
      frame_count: frames.length,
      route_keys: [routeRef],
    });
  }
  return ways;
}

export async function qualifyCatalogRoute({
  routeRef,
  record,
  poses,
  token,
  serverRequests,
  runParseStats,
  roadIndex,
}) {
  const fetchOutcome = await fetchLaneEdgeGeojson({
    routeRef,
    dongle: record.dongle,
    route: record.route,
    token,
    serverRequests,
    runParseStats,
  });
  if (fetchOutcome.malformed) {
    return {
      route_ref: routeRef,
      route_fetch_status: 'malformed_response',
      parse_reason: fetchOutcome.parseReason,
      route_verdict: null,
      labelled_ways_on_route: 0,
      eligible_labelled_ways: 0,
      held_out_single_best: null,
      held_out_multi_frame: null,
      disqualification_reasons: ['malformed_geojson_response'],
      retryable: true,
      unknown_road_lane_count_emitted: false,
      selected_lane_count: undefined,
    };
  }
  const geo = fetchOutcome.geojson;
  const laneEdge = geo?.features || [];
  const bundle_ok = Boolean(geo) && poses.length > 0;
  const ways = buildWaysMapFromServerRoute({
    routeRef,
    poses,
    laneEdgeFeatures: laneEdge,
    roadIndex,
  });
  const evaluation = evaluateRoute(ways, routeRef);
  let row = qualifyRoute({
    routeKey: routeRef,
    bundle_ok,
    waysMap: ways,
    evaluation,
  });
  row = attachMultiMetrics(row, evaluation);
  return {
    route_ref: routeRef,
    route_fetch_status: bundle_ok ? 'ok' : 'insufficient_route_coverage',
    route_verdict: row.route_verdict,
    labelled_ways_on_route: row.labelled_one_way_ways,
    eligible_labelled_ways: row.eligible_labelled_ways,
    held_out_single_best: row.held_out_single_best,
    held_out_multi_frame: row.held_out_multi_frame,
    disqualification_reasons: row.disqualification_reasons,
    retryable: false,
    unknown_road_lane_count_emitted: false,
  };
}

export async function qualifyTopRoutes({
  topRouteRefs,
  recordByRef,
  posesByRef,
  token,
  serverRequests,
  runParseStats = null,
}) {
  const roadIndex = JSON.parse(fs.readFileSync(roadIndexPath(DEFAULT_LOCAL_AREA_ID), 'utf8'));
  const results = [];
  const globalStats = runParseStats || emptyGeoJsonParseStats();

  for (const routeRef of topRouteRefs) {
    await sleep(250);
    const rec = recordByRef.get(routeRef);
    if (!rec) continue;
    const poses = posesByRef.get(routeRef) || [];
    results.push(
      await qualifyCatalogRoute({
        routeRef,
        record: rec,
        poses,
        token,
        serverRequests,
        runParseStats: globalStats,
        roadIndex,
      })
    );
  }
  return { results, parseStats: globalStats };
}

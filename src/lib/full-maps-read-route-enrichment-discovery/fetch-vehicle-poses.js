import fs from 'node:fs';
import path from 'node:path';
import { MAPS_READ_API_BASE } from '../selected-route-paths.js';
import { curlGetToFile } from '../selected-route-curl.js';
import { redactDongle, redactRoute } from '../update-preview-prepare.js';
import { validateRawPageBuffer } from '../selected-route-page-validate.js';
import { shouldNeverRetryStatus } from '../selected-route-pagination.js';
import { backoffMs, isTransientHttpStatus } from '../routes-list-pagination.js';
import { DATA_DIR, POSE_FETCH } from './constants.js';
import { importLocalVehiclePosesIfAvailable } from './local-pose-import.js';
import {
  parseMapsReadGeoJsonFromUtf8,
  mergeGeoJsonParseStats,
  emptyGeoJsonParseStats,
} from './parse-maps-read-geojson.js';

const POSE_RAW_DIR = path.join(DATA_DIR, 'vehicle-pose-raw');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildGeojsonUrl(dongle, route, afterSeg) {
  const q = new URLSearchParams({
    dongle,
    route,
    layers: POSE_FETCH.layers,
    max_features: POSE_FETCH.maxFeatures,
  });
  if (afterSeg != null) q.set('after_seg', String(afterSeg));
  return `${MAPS_READ_API_BASE}/v1/geojson?${q.toString()}`;
}

export function poseCheckpointPath(routeRef) {
  return path.join(DATA_DIR, 'pose-index', `${routeRef}.json`);
}

function parseGeojsonPageBuffer(buf, routeRef, runStats) {
  const parsed = parseMapsReadGeoJsonFromUtf8(buf.toString('utf8'));
  mergeGeoJsonParseStats(runStats, parsed.stats);
  if (!parsed.ok) {
    return {
      ok: false,
      route_fetch_status: 'malformed_response',
      parse_reason: parsed.parseReason,
      route_ref: routeRef,
    };
  }
  return { ok: true, geojson: parsed.geojson };
}

export async function fetchVehiclePosesForRoute({
  routeRef,
  dongle,
  route,
  token,
  serverRequests,
  apiState = null,
  liveApiOnly = false,
  runParseStats = null,
}) {
  const runStats = runParseStats || emptyGeoJsonParseStats();
  const ck = poseCheckpointPath(routeRef);
  const rawDir = path.join(POSE_RAW_DIR, routeRef);
  if (fs.existsSync(ck)) {
    const prior = JSON.parse(fs.readFileSync(ck, 'utf8'));
    const hasRaw =
      fs.existsSync(rawDir) && fs.readdirSync(rawDir).some((n) => n.endsWith('.geojson'));
    const poseCount = prior.pose_count ?? prior.vehicle_pose_count ?? 0;
    if (!hasRaw || poseCount < 1) {
      fs.unlinkSync(ck);
    } else {
      return { ok: true, skipped: true, summary: prior, parseStats: runStats };
    }
  }

  fs.mkdirSync(rawDir, { recursive: true });
  const expectedRoute = { dongle, route };
  const allFeatures = [];
  let afterSeg = null;
  let pageNumber = 0;
  const seenAfter = new Set();
  let stopReason = null;

  const skipLiveApi = apiState?.liveDisabled === true;

  while (!stopReason && pageNumber < POSE_FETCH.maxPagesPerRoute) {
    if (skipLiveApi) {
      stopReason = 'live_api_disabled';
      break;
    }
    if (afterSeg != null) {
      if (seenAfter.has(afterSeg)) {
        stopReason = 'next_after_seg_repeated';
        break;
      }
      seenAfter.add(afterSeg);
    }
    await sleep(POSE_FETCH.minDelayMs);

    const fileName =
      pageNumber === 0 && afterSeg == null
        ? 'page-000-first.geojson'
        : `page-${String(pageNumber).padStart(3, '0')}-after-${afterSeg}.geojson`;
    const finalPath = path.join(rawDir, fileName);
    const url = buildGeojsonUrl(dongle, route, afterSeg);
    const urlPath = `/v1/geojson?dongle=${redactDongle(dongle)}&route=${redactRoute(route)}&layers=${POSE_FETCH.layers}${afterSeg != null ? `&after_seg=${afterSeg}` : ''}`;

    if (fs.existsSync(finalPath)) {
      const buf = fs.readFileSync(finalPath);
      const pageParse = parseGeojsonPageBuffer(buf, routeRef, runStats);
      if (!pageParse.ok) {
        return {
          ok: false,
          skipped: false,
          route_fetch_status: pageParse.route_fetch_status,
          parse_reason: pageParse.parse_reason,
          parseStats: runStats,
        };
      }
      const validation = validateRawPageBuffer(Buffer.from(JSON.stringify(pageParse.geojson), 'utf8'), {
        expectedRoute,
        previousNextAfterSeg: pageNumber > 0 ? afterSeg : null,
        requestedAfterSeg: afterSeg,
      });
      serverRequests.push({ method: 'GET', path: urlPath, status: 200, skipped_cache: true, route_ref: routeRef });
      allFeatures.push(...(pageParse.geojson.features || []));
      if (validation.truncated && validation.nextAfterSeg != null) {
        afterSeg = validation.nextAfterSeg;
        pageNumber += 1;
        continue;
      }
      stopReason = validation.truncated ? 'truncated_chain_end' : 'complete';
      break;
    }

    const partPath = `${finalPath}.part`;
    const headerPath = path.join(rawDir, `.hdr-${pageNumber}.tmp`);
    let status = 0;
    for (let attempt = 0; attempt <= 3; attempt += 1) {
      const res = await curlGetToFile(url, { token, outPath: partPath, headerPath });
      status = res.status;
      serverRequests.push({ method: 'GET', path: urlPath, status, attempt, route_ref: routeRef });
      if (shouldNeverRetryStatus(status)) {
        stopReason = `http_${status}`;
        break;
      }
      if (status >= 400 && isTransientHttpStatus(status) && attempt < 3) {
        await sleep(backoffMs(attempt));
        continue;
      }
      break;
    }
    if (stopReason) break;
    if (status < 200 || status >= 300) {
      stopReason = `http_${status}`;
      if (status === 502 || status === 503 || status === 504) {
        if (apiState) apiState.liveDisabled = true;
      }
      break;
    }
    const buf = fs.readFileSync(partPath);
    const pageParse = parseGeojsonPageBuffer(buf, routeRef, runStats);
    if (!pageParse.ok) {
      try {
        fs.unlinkSync(partPath);
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        skipped: false,
        route_fetch_status: pageParse.route_fetch_status,
        parse_reason: pageParse.parse_reason,
        parseStats: runStats,
      };
    }
    fs.writeFileSync(finalPath, `${JSON.stringify(pageParse.geojson, null, 2)}\n`, 'utf8');
    try {
      fs.unlinkSync(partPath);
    } catch {
      /* ignore */
    }
    if (fs.existsSync(headerPath)) fs.unlinkSync(headerPath);
    const validation = validateRawPageBuffer(Buffer.from(JSON.stringify(pageParse.geojson), 'utf8'), {
      expectedRoute,
      previousNextAfterSeg: pageNumber > 0 ? afterSeg : null,
      requestedAfterSeg: afterSeg,
    });
    allFeatures.push(...(pageParse.geojson.features || []));
    if (validation.truncated && validation.nextAfterSeg != null) {
      afterSeg = validation.nextAfterSeg;
      pageNumber += 1;
      continue;
    }
    stopReason = validation.truncated ? 'truncated_chain_end' : 'complete';
    break;
  }

  let poses = allFeatures.filter((f) => f.properties?.layer === 'vehicle_pose');
  let localImport = null;
  const allowLocal = !liveApiOnly && process.env.FULL_DISCOVERY_LIVE_API_ONLY !== '1';
  if (!poses.length && allowLocal) {
    localImport = importLocalVehiclePosesIfAvailable({ routeRef, dongle, route });
    if (localImport?.imported) {
      poses = loadVehiclePosesFromRaw(routeRef, runStats);
      if (!stopReason || stopReason === 'live_api_disabled') stopReason = 'local_preview_import';
      serverRequests.push({
        method: 'GET',
        path: `/v1/geojson?layers=vehicle_pose&route_ref=${routeRef}`,
        status: 200,
        route_ref: routeRef,
        note: 'vehicle_pose_satisfied_from_local_derived_preview',
        source: localImport.source,
      });
    }
  }
  const summary = {
    route_ref: routeRef,
    pose_fetch_stop_reason: stopReason,
    vehicle_pose_count: poses.length,
    geojson_page_count: pageNumber + 1,
    local_preview_import: localImport?.source ?? null,
    schema_status:
      stopReason === 'complete' || stopReason === 'local_preview_import' ? 'complete' : 'partial_or_error',
    poses,
  };
  if (poses.length > 0) {
    fs.mkdirSync(path.dirname(ck), { recursive: true });
    fs.writeFileSync(ck, `${JSON.stringify({ ...summary, poses: undefined, pose_count: poses.length })}\n`);
  }
  const ok =
    stopReason !== 'http_401' &&
    stopReason !== 'http_403' &&
    (poses.length > 0 || stopReason === 'complete' || stopReason === 'local_preview_import');
  return { ok, skipped: false, summary, poses, parseStats: runStats };
}

export function loadVehiclePosesFromRaw(routeRef, runParseStats = null) {
  const runStats = runParseStats || emptyGeoJsonParseStats();
  const rawDir = path.join(POSE_RAW_DIR, routeRef);
  if (!fs.existsSync(rawDir)) return [];
  const poses = [];
  for (const name of fs.readdirSync(rawDir).filter((n) => n.endsWith('.geojson'))) {
    const parsed = parseMapsReadGeoJsonFromUtf8(fs.readFileSync(path.join(rawDir, name), 'utf8'));
    mergeGeoJsonParseStats(runStats, parsed.stats);
    if (!parsed.ok) continue;
    for (const f of parsed.geojson.features || []) {
      if (f.properties?.layer === 'vehicle_pose') poses.push(f);
    }
  }
  return poses;
}

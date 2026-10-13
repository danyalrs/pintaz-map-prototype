#!/usr/bin/env node
/**
 * Read-only Maps Read route discovery for Bukit pilot (V1).
 * Writes reports/maps_read_bukit_route_discovery_v1/ only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { ROOT_DIR } from '../src/config.js';
import { sha256Hex, normalizeBareNanInJson } from '../src/lib/json-nan-normalize.js';
import { verifyProtectedInputHashes, readGitHead } from '../src/lib/multi-drive-rebuild-guard.js';
import { BUKIT_PILOT_BBOX, BUKIT_PILOT_BBOX_PARTS } from '../src/lib/bukit-route-shortlist-paths.js';
import { ROUTES_API_SEMANTICS } from '../src/lib/bukit-route-api-semantics.js';
import {
  ROUTES_LIST_LIMITS,
  evaluateRoutesOffsetStep,
  backoffMs,
  isTransientHttpStatus,
  shouldNeverRetryRoutesStatus,
} from '../src/lib/routes-list-pagination.js';
import {
  loadRawPageManifest,
  mergeInventoryFromPages,
  validatePaginationContinuity,
  matchSelectedRoute,
} from '../src/lib/bukit-route-inventory.js';
import {
  buildDriveReferenceMap,
  routeSortKey,
  toRedactedRouteEntry,
  containsFullDongle,
  redactRouteTime,
} from '../src/lib/bukit-route-redaction.js';
import { MAPS_READ_API_BASE } from '../src/lib/selected-route-paths.js';
import { ROUTE_SELECTION_PRIVATE_PATH, resolveUpdatePreviewPaths } from '../src/lib/update-preview-paths.js';
import { curlGetToFile } from '../src/lib/selected-route-curl.js';
import { validateRawPageBuffer } from '../src/lib/selected-route-page-validate.js';
import {
  PAGINATION_LIMITS,
  shouldNeverRetryStatus,
} from '../src/lib/selected-route-pagination.js';
import { redactDongle, redactRoute } from '../src/lib/update-preview-prepare.js';
import { OBSERVATION_ROUTES } from '../src/lib/local-route-explorer/config.js';
import { DRIVE_REF_MAP_PRIVATE_PATH, ROUTE_RESULTS_PRIVATE_PATH, probeRawPath } from '../src/lib/bukit-page1-probe-paths.js';
import {
  loadActiveRouteVehicleGrid,
  measurePage1PilotCoverage,
  vehiclePoseGridCells,
} from '../src/lib/bukit-page1-coverage.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'maps_read_bukit_route_discovery_v1');
const RAW_DIR = path.join(REPORT_DIR, 'private', 'routes-list-raw');
const FULL_DL_BASE = path.join(REPORT_DIR, 'private', 'full-route-downloads');
const CHECKPOINT = path.join(ROOT_DIR, '.checkpoint_test_backup', 'pre_maps_read_bukit_route_discovery_v1');

function writeJson(p, o) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(o, null, 2)}\n`, 'utf8');
}

function writeText(p, t) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, t, 'utf8');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pageFileName(pageNumber, offset) {
  return `page-${String(pageNumber).padStart(3, '0')}-offset-${offset}.json`;
}

function loadJsonIfExists(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function ensureCheckpoint(head) {
  fs.mkdirSync(CHECKPOINT, { recursive: true });
  writeText(path.join(CHECKPOINT, 'HEAD.txt'), `${head}\n`);
}

async function fetchRoutesListPage({ pageNumber, offset, token, serverRequests }) {
  const finalPath = path.join(RAW_DIR, pageFileName(pageNumber, offset));
  const urlPath = `/v1/routes?bbox=${BUKIT_PILOT_BBOX}&limit=${ROUTES_LIST_LIMITS.defaultLimit}&offset=${offset}`;
  const url = `${MAPS_READ_API_BASE}${urlPath}`;

  if (fs.existsSync(finalPath)) {
    const buf = fs.readFileSync(finalPath);
    const page = JSON.parse(buf.toString('utf8'));
    serverRequests.push({ method: 'GET', path: urlPath, status: 200, skipped_cache: true, byte_size: buf.length });
    return { ok: true, skipped: true, path: finalPath, page, http_status: 200 };
  }

  const partPath = `${finalPath}.part`;
  const headerPath = path.join(RAW_DIR, `.headers-${pageNumber}.tmp`);
  for (let attempt = 0; attempt <= ROUTES_LIST_LIMITS.maxRetriesTransient; attempt += 1) {
    try {
      const { status } = await curlGetToFile(url, { token, outPath: partPath, headerPath });
      serverRequests.push({ method: 'GET', path: urlPath, status, attempt });
      if (shouldNeverRetryRoutesStatus(status)) return { ok: false, stopReason: `http_${status}`, http_status: status };
      if (status >= 400 && isTransientHttpStatus(status) && attempt < ROUTES_LIST_LIMITS.maxRetriesTransient) {
        await sleep(backoffMs(attempt));
        continue;
      }
      if (status < 200 || status >= 300) return { ok: false, stopReason: `http_${status}`, http_status: status };
      const buf = fs.readFileSync(partPath);
      fs.renameSync(partPath, finalPath);
      if (fs.existsSync(headerPath)) fs.unlinkSync(headerPath);
      const page = JSON.parse(buf.toString('utf8'));
      return { ok: true, skipped: false, path: finalPath, page, http_status: status };
    } catch (e) {
      if (attempt < ROUTES_LIST_LIMITS.maxRetriesTransient) {
        await sleep(backoffMs(attempt));
        continue;
      }
      return { ok: false, stopReason: 'network_error', message: e.message };
    }
  }
  return { ok: false, stopReason: 'exhausted_retries' };
}

async function paginateRoutesList(token) {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const serverRequests = [];
  let offset = 0;
  let pageNumber = 0;
  let totalBytes = 0;
  let totalRecords = 0;
  const pages = [];
  const seenOffsets = new Set();
  let stopReason = null;

  while (pageNumber < ROUTES_LIST_LIMITS.maxPages) {
    if (seenOffsets.has(offset)) {
      stopReason = 'next_offset_repeated';
      break;
    }
    seenOffsets.add(offset);
    await sleep(ROUTES_LIST_LIMITS.minDelayMs);

    const result = await fetchRoutesListPage({ pageNumber, offset, token, serverRequests });
    if (!result.ok) {
      stopReason = result.stopReason;
      break;
    }

    const buf = fs.readFileSync(result.path);
    totalBytes += buf.length;
    if (totalBytes > ROUTES_LIST_LIMITS.maxTotalBytes) {
      stopReason = 'total_bytes_exceeded';
      break;
    }

    const page = result.page;
    const returned = page.returned ?? (page.routes?.length || 0);
    totalRecords += returned;
    pages.push({
      page_number: pageNumber,
      file_name: path.basename(result.path),
      offset: page.offset ?? offset,
      returned,
      next_offset: page.next_offset ?? null,
      http_status: result.http_status,
      skipped: result.skipped,
    });

    if (totalRecords >= ROUTES_LIST_LIMITS.maxRecords) {
      stopReason = 'max_records';
      break;
    }

    const step = evaluateRoutesOffsetStep({
      returned,
      nextOffset: page.next_offset,
      previousOffset: offset,
      seenOffsets,
    });
    if (step.stop) {
      stopReason = step.reason;
      break;
    }
    offset = page.next_offset;
    pageNumber += 1;
  }
  if (!stopReason && pageNumber >= ROUTES_LIST_LIMITS.maxPages) stopReason = 'max_pages';

  return { stopReason, pages, totalBytes, totalRecords, serverRequests };
}

function buildGeojsonUrl(dongle, route, afterSeg) {
  const layers = 'vehicle_pose,lane_point,edge_point,gps_point';
  const q = new URLSearchParams({ dongle, route, layers, max_features: '80000' });
  if (afterSeg != null) q.set('after_seg', String(afterSeg));
  return `${MAPS_READ_API_BASE}/v1/geojson?${q.toString()}`;
}

function geojsonPageFileName(pageNumber, afterSeg) {
  const n = String(pageNumber).padStart(3, '0');
  return `page-${n}-after-${afterSeg}.geojson`;
}

async function downloadFullRouteDiagnostic({ discoveryRef, dongle, route, token, serverRequests }) {
  const rawDir = path.join(FULL_DL_BASE, discoveryRef, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  const expectedRoute = { dongle, route };
  const pages = [];
  let afterSeg = null;
  let pageNumber = 0;
  let totalBytes = 0;
  const seenAfter = new Set();
  let stopReason = null;
  let complete = false;

  while (!stopReason && pageNumber < PAGINATION_LIMITS.maxPages) {
    if (afterSeg != null) {
      if (seenAfter.has(afterSeg)) {
        stopReason = 'next_after_seg_repeated';
        break;
      }
      seenAfter.add(afterSeg);
    }

    const fileName = pageNumber === 0 && afterSeg == null
      ? 'page-000-first.geojson'
      : geojsonPageFileName(pageNumber, afterSeg);
    const finalPath = path.join(rawDir, fileName);
    const urlPath = `/v1/geojson?dongle=${redactDongle(dongle)}&route=${redactRoute(route)}${afterSeg != null ? `&after_seg=${afterSeg}` : ''}`;
    const url = buildGeojsonUrl(dongle, route, afterSeg);

    if (fs.existsSync(finalPath)) {
      const buf = fs.readFileSync(finalPath);
      const validation = validateRawPageBuffer(buf, {
        expectedRoute,
        previousNextAfterSeg: pages.length ? pages[pages.length - 1].next_after_seg : null,
        requestedAfterSeg: afterSeg,
      });
      serverRequests.push({ method: 'GET', path: urlPath, status: 200, skipped_cache: true, discovery_ref: discoveryRef });
      pages.push({
        file: fileName,
        byte_size: buf.length,
        truncated: validation.truncated,
        next_after_seg: validation.nextAfterSeg,
        feature_count: validation.featureCount,
      });
      totalBytes += buf.length;
      if (validation.truncated === false && (validation.nextAfterSeg == null || validation.nextAfterSeg === undefined)) {
        complete = true;
        stopReason = 'route_complete';
        break;
      }
      afterSeg = validation.nextAfterSeg;
      pageNumber += 1;
      if (afterSeg == null) {
        stopReason = 'next_after_seg_absent';
        break;
      }
      await sleep(PAGINATION_LIMITS.minDelayMs);
      continue;
    }

    const partPath = `${finalPath}.part`;
    const headerPath = path.join(rawDir, `.headers-${pageNumber}.tmp`);
    await sleep(PAGINATION_LIMITS.minDelayMs);

    let downloaded = false;
    for (let attempt = 0; attempt <= PAGINATION_LIMITS.maxRetriesTransient; attempt += 1) {
      try {
        const { status } = await curlGetToFile(url, { token, outPath: partPath, headerPath });
        serverRequests.push({
          method: 'GET',
          path: urlPath,
          status,
          attempt,
          discovery_ref: discoveryRef,
        });
        if (shouldNeverRetryStatus(status)) {
          stopReason = `http_${status}`;
          break;
        }
        if (status < 200 || status >= 300) {
          if (status >= 400 && isTransientHttpStatus(status) && attempt < PAGINATION_LIMITS.maxRetriesTransient) {
            await sleep(backoffMs(attempt));
            continue;
          }
          stopReason = `http_${status}`;
          break;
        }
        const buf = fs.readFileSync(partPath);
        if (buf.length > PAGINATION_LIMITS.maxSingleResponseBytes) {
          stopReason = 'response_too_large';
          break;
        }
        const validation = validateRawPageBuffer(buf, {
          expectedRoute,
          previousNextAfterSeg: pages.length ? pages[pages.length - 1].next_after_seg : null,
          requestedAfterSeg: afterSeg,
        });
        if (!validation.ok) {
          stopReason = 'validation_failed';
          break;
        }
        fs.renameSync(partPath, finalPath);
        if (fs.existsSync(headerPath)) fs.unlinkSync(headerPath);
        pages.push({
          file: fileName,
          byte_size: buf.length,
          truncated: validation.truncated,
          next_after_seg: validation.nextAfterSeg,
          feature_count: validation.featureCount,
        });
        totalBytes += buf.length;
        downloaded = true;
        if (validation.truncated === false && (validation.nextAfterSeg == null || validation.nextAfterSeg === undefined)) {
          complete = true;
          stopReason = 'route_complete';
        } else {
          afterSeg = validation.nextAfterSeg;
          pageNumber += 1;
          if (afterSeg == null) stopReason = 'next_after_seg_absent';
        }
        break;
      } catch (e) {
        if (attempt < PAGINATION_LIMITS.maxRetriesTransient) {
          await sleep(backoffMs(attempt));
          continue;
        }
        stopReason = 'network_error';
      }
    }
    if (!downloaded && !complete) break;
    if (stopReason) break;
    if (totalBytes > PAGINATION_LIMITS.maxTotalBytes) {
      stopReason = 'total_bytes_exceeded';
      break;
    }
  }

  let mergedFeatures = 0;
  let gridMetrics = null;
  if (pages.length && fs.existsSync(path.join(rawDir, pages[0].file))) {
    try {
      const text = fs.readFileSync(path.join(rawDir, pages[0].file), 'utf8');
      const { normalized } = normalizeBareNanInJson(text);
      const geo = JSON.parse(normalized);
      mergedFeatures = geo.features?.length ?? 0;
      const activeGrid = loadActiveRouteVehicleGrid(resolveUpdatePreviewPaths().previewPath);
      gridMetrics = measurePage1PilotCoverage(geo.features || [], activeGrid);
    } catch {
      gridMetrics = null;
    }
  }

  return {
    discovery_ref: discoveryRef,
    stop_reason: stopReason,
    route_complete: complete,
    page_count: pages.length,
    total_bytes: totalBytes,
    pages,
    first_page_feature_count: mergedFeatures,
    first_page_pilot_metrics: gridMetrics,
    output_dir: path.relative(ROOT_DIR, rawDir),
  };
}

function loadLocalPreparedKeys() {
  const keys = new Set();
  const entries = [];
  const selection = loadJsonIfExists(ROUTE_SELECTION_PRIVATE_PATH);
  if (selection?.dongle && selection?.route) {
    const key = `${selection.dongle}\0${selection.route}`;
    keys.add(key);
    entries.push({ kind: 'active_production', route_key: 'active', server_list_key: key });
  }
  const refMap = loadJsonIfExists(DRIVE_REF_MAP_PRIVATE_PATH);
  const probeByRef = new Map((refMap?.mappings || []).map((m) => [m.probe_ref, m]));
  for (const spec of OBSERVATION_ROUTES) {
    if (spec.route_key === 'active') continue;
    const m = probeByRef.get(spec.probe_ref);
    if (!m?.dongle || !m?.route) continue;
    const key = `${m.dongle}\0${m.route}`;
    keys.add(key);
    const hasRaw = fs.existsSync(probeRawPath(spec.probe_ref));
    entries.push({
      kind: 'local_diagnostic_prepared',
      route_key: spec.route_key,
      probe_ref: spec.probe_ref,
      inventory_drive_ref: m.inventory_drive_ref,
      server_list_key: key,
      raw_page1_present: hasRaw,
      ui_option_label: spec.option_label,
    });
  }
  return { keys, entries };
}

function loadProbeMetricsByKey() {
  const doc = loadJsonIfExists(ROUTE_RESULTS_PRIVATE_PATH);
  const map = new Map();
  for (const r of doc?.routes || []) {
    if (!r.dongle || !r.route) continue;
    map.set(`${r.dongle}\0${r.route}`, r);
  }
  return map;
}

function scoreRoute(record, ctx) {
  const key = routeSortKey(record);
  const probe = ctx.probeMetrics.get(key);
  const refMap = ctx.refMap;
  const driveRef = refMap.get(key);
  const listFeatureProxy = (record.model_frames || 0) + (record.gps_fixes || 0);

  if (key === ctx.activeKey) {
    return { ranking_bucket: 'active_production', exclude_reason: null, scores: {} };
  }
  if (ctx.localPrepared.keys.has(key)) {
    return { ranking_bucket: 'local_prepared_ui_route', exclude_reason: null, scores: { list_feature_proxy: listFeatureProxy } };
  }
  if (record.dongle === ctx.activeDongle) {
    return { ranking_bucket: 'exclude', exclude_reason: 'same_dongle_as_active', scores: {} };
  }

  const overlap = probe?.metrics?.grid_cells_overlap_active ?? null;
  const novel = probe?.metrics?.grid_cells_novel_vs_active ?? null;
  const pathM = probe?.metrics?.inside_vehicle_path_length_m ?? null;
  const dense = probe?.metrics?.inside_lane_point ?? null;
  const continuous = probe?.metrics?.max_continuous_inside_vehicle_poses ?? null;

  const scores = {
    list_model_frames: record.model_frames,
    list_gps_fixes: record.gps_fixes,
    list_feature_proxy: listFeatureProxy,
    page1_overlap_cells: overlap,
    page1_novel_cells: novel,
    page1_inside_path_m: pathM,
    page1_inside_lane_points: dense,
    page1_max_continuous_poses: continuous,
  };

  let ranking_bucket = 'exclude';
  let exclude_reason = 'insufficient_metadata';

  if (probe?.metrics) {
    if (overlap >= 8 && novel <= 5) ranking_bucket = 'repeated_road_validation_candidate';
    else if (novel >= 10) ranking_bucket = 'novel_coverage_candidate';
    else if ((dense ?? 0) >= 3000 || listFeatureProxy >= 15000) ranking_bucket = 'dense_comparison_candidate';
    else if (listFeatureProxy >= 5000) ranking_bucket = 'dense_comparison_candidate';
    else ranking_bucket = 'exclude';
    exclude_reason = null;
  } else if (listFeatureProxy >= 12000) {
    ranking_bucket = 'dense_comparison_candidate';
    exclude_reason = null;
  } else if (listFeatureProxy >= 4000) {
    ranking_bucket = 'novel_coverage_candidate';
    exclude_reason = null;
  }

  return { ranking_bucket, exclude_reason, scores, drive_ref: driveRef };
}

function pickTopIndependentCandidates(records, ctx, limit = 3) {
  const buckets = {
    repeated_road_validation_candidate: [],
    novel_coverage_candidate: [],
    dense_comparison_candidate: [],
  };
  for (const r of records) {
    const s = scoreRoute(r, ctx);
    if (s.ranking_bucket === 'exclude' || s.ranking_bucket === 'active_production' || s.ranking_bucket === 'local_prepared_ui_route') {
      continue;
    }
    if (buckets[s.ranking_bucket]) buckets[s.ranking_bucket].push({ record: r, score: s });
  }

  const sortFn = (a, b) =>
    (b.score.scores.list_model_frames || 0) - (a.score.scores.list_model_frames || 0) ||
    routeSortKey(a.record).localeCompare(routeSortKey(b.record));

  const ordered = [
    ...buckets.repeated_road_validation_candidate.sort(sortFn),
    ...buckets.novel_coverage_candidate.sort(sortFn),
    ...buckets.dense_comparison_candidate.sort(sortFn),
  ];

  const picked = [];
  const usedDongles = new Set();
  for (const item of ordered) {
    if (picked.length >= limit) break;
    if (usedDongles.has(item.record.dongle)) continue;
    usedDongles.add(item.record.dongle);
    picked.push(item);
  }

  if (picked.length < limit) {
    const fallback = [...records]
      .filter((r) => {
        const key = routeSortKey(r);
        if (key === ctx.activeKey) return false;
        if (ctx.localPrepared.keys.has(key)) return false;
        if (r.dongle === ctx.activeDongle) return false;
        if (usedDongles.has(r.dongle)) return false;
        return true;
      })
      .sort((a, b) => b.model_frames - a.model_frames);
    for (const r of fallback) {
      if (picked.length >= limit) break;
      usedDongles.add(r.dongle);
      picked.push({ record: r, score: scoreRoute(r, ctx) });
    }
  }

  return picked.map((p, i) => ({
    discovery_ref: `candidate-${String(i + 1).padStart(3, '0')}`,
    ranking_bucket: p.score.ranking_bucket,
    drive_ref: ctx.refMap.get(routeSortKey(p.record)),
    route_datetime_redacted: redactRouteTime(p.record.route),
    list_model_frames: p.record.model_frames,
    list_gps_fixes: p.record.gps_fixes,
    scores: p.score.scores,
    dongle: p.record.dongle,
    route: p.record.route,
  }));
}

async function main() {
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  const head = readGitHead(ROOT_DIR);
  const porcelain = execSync('git status --porcelain', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  const protected_hashes = verifyProtectedInputHashes(ROOT_DIR);
  ensureCheckpoint(head);

  const token = (process.env.MAPS_READ_TOKEN || '').trim();
  if (!token) {
    console.error('MAPS_READ_TOKEN missing');
    process.exit(2);
  }

  const listResult = await paginateRoutesList(token);
  const pageMetas = loadRawPageManifest(RAW_DIR);
  const merged = mergeInventoryFromPages(pageMetas, (fileName) =>
    fs.readFileSync(path.join(RAW_DIR, fileName))
  );
  const paginationIssues = validatePaginationContinuity(pageMetas);

  const selection = loadJsonIfExists(ROUTE_SELECTION_PRIVATE_PATH);
  const activeMatch = matchSelectedRoute(merged.records, selection?.selected || selection);
  const activeKey = selection?.selected
    ? routeSortKey(selection.selected)
    : selection?.dongle && selection?.route
      ? `${selection.dongle}\0${selection.route}`
      : activeMatch
        ? routeSortKey(activeMatch)
        : null;
  const activeDongle = selection?.selected?.dongle || selection?.dongle || activeMatch?.dongle || null;

  const refMap = buildDriveReferenceMap(merged.records);
  const activeKeys = activeKey ? new Set([activeKey]) : new Set();
  const localPrepared = loadLocalPreparedKeys();
  const probeMetrics = loadProbeMetricsByKey();
  const activeGrid = loadActiveRouteVehicleGrid(resolveUpdatePreviewPaths().previewPath);

  const catalog = merged.records.map((r) => {
    const key = routeSortKey(r);
    const probe = probeMetrics.get(key);
    const scoring = scoreRoute(r, {
      activeKey,
      activeDongle,
      localPrepared,
      probeMetrics,
      refMap,
    });
    const localEntry = localPrepared.entries.find((e) => e.server_list_key === key);
    return {
      drive_ref: refMap.get(key),
      route_datetime_redacted: redactRouteTime(r.route),
      status: 'listed_in_bbox',
      version: r.version,
      segments: r.segments,
      model_frames: r.model_frames,
      gps_fixes: r.gps_fixes,
      list_count_scope: ROUTES_API_SEMANTICS.per_route_model_frames_scope,
      pilot_bbox: BUKIT_PILOT_BBOX_PARTS,
      bbox_intersection_rule: ROUTES_API_SEMANTICS.segment_in_bbox_rule,
      local_copy_status: localEntry
        ? localEntry.kind
        : key === activeKey
          ? 'active_production'
          : 'none',
      local_route_key: localEntry?.route_key ?? (key === activeKey ? 'active' : null),
      page1_probe_status: probe?.probe_status ?? null,
      feature_count_page1: probe?.feature_count ?? null,
      pilot_metrics_page1: probe?.metrics
        ? {
            grid_cells_overlap_active: probe.metrics.grid_cells_novel_vs_active != null
              ? probe.metrics.grid_cells_overlap_active
              : null,
            grid_cells_novel_vs_active: probe.metrics.grid_cells_novel_vs_active,
            inside_vehicle_path_length_m: probe.metrics.inside_vehicle_path_length_m,
            inside_lane_point: probe.metrics.inside_lane_point,
          }
        : null,
      ranking_bucket: scoring.ranking_bucket,
      exclude_reason: scoring.exclude_reason,
      existing_active_route: key === activeKey ? 'yes' : 'no',
      same_dongle_as_active: r.dongle === activeDongle ? 'yes' : 'no',
    };
  });

  const rankingSummary = {
    total_server_routes_in_pilot_bbox: merged.record_count,
    local_ui_prepared_routes: OBSERVATION_ROUTES.length,
    local_ui_note:
      'The six observation-route dropdown entries are locally prepared bundles, not an exhaustive server catalog.',
    active_route_in_server_list: Boolean(activeMatch),
    buckets: {},
  };
  for (const c of catalog) {
    rankingSummary.buckets[c.ranking_bucket] = (rankingSummary.buckets[c.ranking_bucket] || 0) + 1;
  }

  const ctx = { activeKey, activeDongle, localPrepared, probeMetrics, refMap };
  const downloadTargets = pickTopIndependentCandidates(merged.records, ctx, 3);

  const allServerRequests = [...listResult.serverRequests];
  const downloaded = [];
  for (const t of downloadTargets) {
    const dl = await downloadFullRouteDiagnostic({
      discoveryRef: t.discovery_ref,
      dongle: t.dongle,
      route: t.route,
      token,
      serverRequests: allServerRequests,
    });
    downloaded.push({
      ...t,
      dongle: undefined,
      route: undefined,
      download: {
        stop_reason: dl.stop_reason,
        route_complete: dl.route_complete,
        page_count: dl.page_count,
        total_bytes: dl.total_bytes,
        output_dir: dl.output_dir,
        first_page_feature_count: dl.first_page_feature_count,
        first_page_pilot_metrics: dl.first_page_pilot_metrics,
      },
    });
  }

  const routeCatalogRedacted = {
    schema: 'pintaz.maps-read-bukit-route-discovery.route-catalog.redacted',
    version: 1,
    generated_at: new Date().toISOString(),
    api_semantics: ROUTES_API_SEMANTICS,
    pagination: {
      stop_reason: listResult.stopReason,
      page_count: listResult.pages.length,
      total_records: merged.record_count,
      pagination_issues: paginationIssues,
    },
    active_grid_cells_50m_vehicle_pose: activeGrid.size,
    routes: catalog,
  };

  const candidateRankingRedacted = {
    schema: 'pintaz.maps-read-bukit-route-discovery.candidate-ranking.redacted',
    version: 1,
    summary: rankingSummary,
    top_independent_download_targets: downloadTargets.map((t) => ({
      discovery_ref: t.discovery_ref,
      drive_ref: t.drive_ref,
      ranking_bucket: t.ranking_bucket,
      route_datetime_redacted: t.route_datetime_redacted,
      list_model_frames: t.list_model_frames,
      scores: t.scores,
    })),
    local_prepared_routes: localPrepared.entries.map((e) => ({
      route_key: e.route_key,
      probe_ref: e.probe_ref,
      inventory_drive_ref: e.inventory_drive_ref,
      raw_page1_present: e.raw_page1_present,
      ui_option_label: e.ui_option_label,
    })),
  };

  const downloadedRedacted = {
    schema: 'pintaz.maps-read-bukit-route-discovery.downloaded-candidates.redacted',
    version: 1,
    candidates: downloaded,
  };

  const serverRequestsRedacted = {
    schema: 'pintaz.maps-read-bukit-route-discovery.server-requests.redacted',
    version: 1,
    requests: allServerRequests,
  };

  for (const obj of [routeCatalogRedacted, candidateRankingRedacted, downloadedRedacted, serverRequestsRedacted]) {
    const text = JSON.stringify(obj);
    if (containsFullDongle(text)) {
      console.error('redaction_leak_detected');
      process.exit(5);
    }
  }

  writeJson(path.join(REPORT_DIR, 'route_catalog.redacted.json'), routeCatalogRedacted);
  writeJson(path.join(REPORT_DIR, 'candidate_ranking.redacted.json'), candidateRankingRedacted);
  writeJson(path.join(REPORT_DIR, 'downloaded_candidates.redacted.json'), downloadedRedacted);
  writeJson(path.join(REPORT_DIR, 'server_requests.redacted.json'), serverRequestsRedacted);

  const validation = {
    branch,
    head,
    checkpoint: path.relative(ROOT_DIR, CHECKPOINT),
    working_tree_porcelain_lines: porcelain ? porcelain.split('\n').length : 0,
    protected_hashes,
    npm_test: null,
    validate_data: null,
    git_diff_check: null,
    server_route_count: merged.record_count,
    list_pagination_stop: listResult.stopReason,
    downloads_attempted: downloaded.length,
  };

  writeJson(path.join(REPORT_DIR, 'validation.json'), validation);

  writeText(
    path.join(REPORT_DIR, 'commands.txt'),
    [
      'node scripts/run-maps-read-bukit-route-discovery-v1.js',
      'npm test',
      'npm run validate:data',
      'git diff --check',
      `node -e "import { verifyProtectedInputHashes } from './src/lib/multi-drive-rebuild-guard.js'; console.log(JSON.stringify(verifyProtectedInputHashes()));"`,
    ].join('\n') + '\n'
  );

  const report = `# Maps Read Bukit route discovery (V1)

## Scope

- **Branch:** \`${branch}\` @ \`${head}\`
- **Pilot bbox:** \`${BUKIT_PILOT_BBOX}\` (2 km × 2 km Bukit Bintang–Imbi)
- **Maps Read list endpoint:** \`GET /v1/routes\` with bbox filter (read-only)

## Important clarifications

1. **The six observation-route dropdown entries are locally prepared routes** (active production bundle plus five diagnostic page-1/full copies). They are **not** a claim that the server exposes only six routes.
2. **This run listed ${merged.record_count} route records** intersecting the pilot bbox via paginated \`/v1/routes\` (stop: \`${listResult.stopReason}\`).
3. **No route was activated** for production, the active-source manifest was not changed, and OSM / lane baseline / comparison classification logic were not modified.
4. **No map change is supported** without the existing per-route OSM-first comparison gates (diagnostic routes remain non-production).

## Server catalog summary

| Metric | Value |
|--------|------:|
| Pages fetched | ${listResult.pages.length} |
| Unique routes | ${merged.record_count} |
| Active route found in list | ${activeMatch ? 'yes' : 'no'} |
| Active 50 m vehicle grid cells (local preview) | ${activeGrid.size} |

## Local prepared routes (UI)

${localPrepared.entries.map((e) => `- **${e.route_key ?? 'active'}** — ${e.ui_option_label ?? e.kind}; page-1 raw present: ${e.raw_page1_present ?? 'n/a'}`).join('\n')}

## Ranking buckets

\`\`\`json
${JSON.stringify(rankingSummary.buckets, null, 2)}
\`\`\`

## Top independent download targets (diagnostic only)

${downloaded.map((d) => `- **${d.discovery_ref}** (\`${d.drive_ref}\`, ${d.ranking_bucket}): ${d.download.page_count} page(s), complete=${d.download.route_complete}, stop=\`${d.download.stop_reason}\``).join('\n')}

Diagnostic GeoJSON pages (if any) live under \`reports/maps_read_bukit_route_discovery_v1/private/full-route-downloads/\` (gitignored with \`reports/\`).

## Safety

- Read-only Maps Read queries and diagnostic downloads only.
- No overwrite of existing \`data/maps-read/\` production bundles.
- No Pending map update / Accept / Reject workflow touched.

## Artifacts

- \`route_catalog.redacted.json\` — full redacted inventory
- \`candidate_ranking.redacted.json\` — buckets and download picks
- \`downloaded_candidates.redacted.json\` — download outcomes
- \`server_requests.redacted.json\` — HTTP paths and statuses (no tokens)
`;

  writeText(path.join(REPORT_DIR, 'FINAL_REPORT.md'), report);

  console.log(
    JSON.stringify(
      {
        ok: true,
        report_dir: path.relative(ROOT_DIR, REPORT_DIR),
        route_count: merged.record_count,
        downloads: downloaded.length,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(String(e.message || e).slice(0, 300));
  process.exit(1);
});

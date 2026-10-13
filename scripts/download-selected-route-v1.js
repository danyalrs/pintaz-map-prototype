#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { ROOT_DIR } from '../src/config.js';
import { sha256Hex } from '../src/lib/json-nan-normalize.js';
import {
  MAPS_READ_API_BASE,
  PAGINATION_RUN_PRIVATE_PATH,
  SELECTED_ROUTE_RAW_DIR,
} from '../src/lib/selected-route-paths.js';
import { loadRouteSelectionPrivate } from '../src/lib/selected-route-identity.js';
import {
  PAGINATION_LIMITS,
  backoffMs,
  evaluatePaginationStep,
  isTransientHttpStatus,
  shouldNeverRetryStatus,
} from '../src/lib/selected-route-pagination.js';
import { validateRawPageBuffer } from '../src/lib/selected-route-page-validate.js';
import { ensurePage000FromExisting } from '../src/lib/selected-route-derived-build.js';
import { curlGetToFile } from '../src/lib/selected-route-curl.js';
import { EXPECTED } from '../src/lib/update-preview-prepare.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(ROOT_DIR, '.env') });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function atomicRename(from, to) {
  fs.renameSync(from, to);
}

function pageFileName(pageNumber, afterSeg) {
  const n = String(pageNumber).padStart(3, '0');
  return `page-${n}-after-${afterSeg}.geojson`;
}

function loadRunState() {
  if (!fs.existsSync(PAGINATION_RUN_PRIVATE_PATH)) return null;
  return JSON.parse(fs.readFileSync(PAGINATION_RUN_PRIVATE_PATH, 'utf8'));
}

function saveRunState(state) {
  fs.mkdirSync(path.dirname(PAGINATION_RUN_PRIVATE_PATH), { recursive: true });
  const tmp = `${PAGINATION_RUN_PRIVATE_PATH}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, PAGINATION_RUN_PRIVATE_PATH);
}

function buildGeojsonUrl(dongle, route, afterSeg) {
  const layers = 'vehicle_pose,lane_point,edge_point,gps_point';
  const q = new URLSearchParams({
    dongle,
    route,
    layers,
    max_features: '80000',
  });
  if (afterSeg != null) q.set('after_seg', String(afterSeg));
  return `${MAPS_READ_API_BASE}/v1/geojson?${q.toString()}`;
}

async function downloadPage({ pageNumber, afterSeg, expectedRoute, previousNextAfterSeg, token }) {
  const finalName = pageFileName(pageNumber, afterSeg);
  const finalPath = path.join(SELECTED_ROUTE_RAW_DIR, finalName);
  if (fs.existsSync(finalPath)) {
    const buf = fs.readFileSync(finalPath);
    const sha = sha256Hex(buf);
    const validation = validateRawPageBuffer(buf, {
      expectedRoute,
      previousNextAfterSeg,
      requestedAfterSeg: afterSeg,
    });
    return {
      skipped: true,
      path: finalPath,
      sha256: sha,
      byte_size: buf.length,
      validation,
      http_status: 200,
    };
  }

  const partPath = `${finalPath}.part`;
  const headerPath = path.join(SELECTED_ROUTE_RAW_DIR, `.headers-${pageNumber}.tmp`);
  const url = buildGeojsonUrl(expectedRoute.dongle, expectedRoute.route, afterSeg);

  let lastStatus = 0;
  for (let attempt = 0; attempt <= PAGINATION_LIMITS.maxRetriesTransient; attempt += 1) {
    if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
    if (fs.existsSync(headerPath)) fs.unlinkSync(headerPath);
    const started = Date.now();
    try {
      const { status } = await curlGetToFile(url, { token, outPath: partPath, headerPath });
      lastStatus = status;
      if (shouldNeverRetryStatus(status)) {
        return { ok: false, stopReason: `http_${status}`, http_status: status };
      }
      if (status >= 400 && isTransientHttpStatus(status) && attempt < PAGINATION_LIMITS.maxRetriesTransient) {
        await sleep(backoffMs(attempt));
        continue;
      }
      if (status < 200 || status >= 300) {
        return { ok: false, stopReason: `http_${status}`, http_status: status };
      }
      const buf = fs.readFileSync(partPath);
      if (buf.length > PAGINATION_LIMITS.maxSingleResponseBytes) {
        return { ok: false, stopReason: 'response_too_large', http_status: status };
      }
      const validation = validateRawPageBuffer(buf, {
        expectedRoute,
        previousNextAfterSeg,
        requestedAfterSeg: afterSeg,
      });
      if (!validation.ok) {
        return { ok: false, stopReason: 'validation_failed', anomalies: validation.anomalies, http_status: status };
      }
      atomicRename(partPath, finalPath);
      if (fs.existsSync(headerPath)) fs.unlinkSync(headerPath);
      return {
        ok: true,
        skipped: false,
        path: finalPath,
        sha256: sha256Hex(buf),
        byte_size: buf.length,
        validation,
        http_status: status,
        download_time_ms: Date.now() - started,
      };
    } catch (e) {
      if (attempt < PAGINATION_LIMITS.maxRetriesTransient) {
        await sleep(backoffMs(attempt));
        continue;
      }
      return { ok: false, stopReason: 'network_error', message: e.message };
    }
  }
  return { ok: false, stopReason: `http_${lastStatus}`, http_status: lastStatus };
}

async function main() {
  const token = (process.env.MAPS_READ_TOKEN || '').trim();
  if (!token) {
    console.error('MAPS_READ_TOKEN missing');
    process.exit(2);
  }

  const expectedRoute = loadRouteSelectionPrivate();
  fs.mkdirSync(SELECTED_ROUTE_RAW_DIR, { recursive: true });

  const page000 = ensurePage000FromExisting();
  if (page000.sha256 !== EXPECTED.rawSha256) {
    console.error('page_000_sha_mismatch');
    process.exit(3);
  }

  const page0Buf = fs.readFileSync(page000.sourcePath);
  const page0Val = validateRawPageBuffer(page0Buf, { expectedRoute, previousNextAfterSeg: null, requestedAfterSeg: null });
  let afterSeg = page0Val.nextAfterSeg ?? EXPECTED.next_after_seg;
  let pageNumber = 1;
  let totalBytes = page0Buf.length;
  const seenAfterSegs = new Set();
  const pages = [
    {
      page_number: 0,
      file: 'page-000-existing.geojson',
      sha256: page000.sha256,
      byte_size: page0Buf.length,
      truncated: page0Val.truncated,
      next_after_seg: page0Val.nextAfterSeg,
    },
  ];

  let stopReason = null;
  let routeComplete = false;

  if (afterSeg == null) {
    stopReason = 'next_after_seg_absent';
  }

  while (!stopReason && pageNumber < PAGINATION_LIMITS.maxPages) {
    if (seenAfterSegs.has(afterSeg)) {
      stopReason = 'next_after_seg_repeated';
      break;
    }
    seenAfterSegs.add(afterSeg);
    await sleep(PAGINATION_LIMITS.minDelayMs);

    const result = await downloadPage({
      pageNumber,
      afterSeg,
      expectedRoute,
      previousNextAfterSeg: pages[pages.length - 1].next_after_seg,
      token,
    });

    if (!result.ok) {
      stopReason = result.stopReason;
      saveRunState({
        stopped_at: new Date().toISOString(),
        stop_reason: stopReason,
        pages,
        total_bytes: totalBytes,
      });
      console.log(
        JSON.stringify(
          {
            ok: false,
            stop_reason: stopReason,
            pages_downloaded: pages.length,
            total_bytes: totalBytes,
          },
          null,
          2
        )
      );
      process.exit(4);
    }

    totalBytes += result.byte_size;
    if (totalBytes > PAGINATION_LIMITS.maxTotalBytes) {
      stopReason = 'total_bytes_exceeded';
      break;
    }

    pages.push({
      page_number: pageNumber,
      file: path.basename(result.path),
      requested_after_seg: afterSeg,
      sha256: result.sha256,
      byte_size: result.byte_size,
      truncated: result.validation.truncated,
      next_after_seg: result.validation.nextAfterSeg,
      feature_count: result.validation.featureCount,
      http_status: result.http_status,
      skipped: result.skipped,
    });

    const endCheck = evaluatePaginationStep({
      truncated: result.validation.truncated,
      nextAfterSeg: result.validation.nextAfterSeg,
      previousAfterSeg: afterSeg,
      seenAfterSegs,
    });
    if (endCheck.stop) {
      stopReason = endCheck.reason;
      routeComplete = endCheck.reason === 'truncated_false';
      break;
    }
    afterSeg = result.validation.nextAfterSeg;
    pageNumber += 1;
  }

  if (!stopReason && pageNumber >= PAGINATION_LIMITS.maxPages) {
    stopReason = 'max_pages';
  }

  saveRunState({
    completed_at: new Date().toISOString(),
    stop_reason: stopReason,
    route_complete: routeComplete,
    pages,
    total_bytes: totalBytes,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        page_count: pages.length,
        route_complete: routeComplete,
        stop_reason: stopReason,
        total_bytes: totalBytes,
        page_hashes: pages.map((p) => p.sha256),
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(String(e.message || e).slice(0, 200));
  process.exit(1);
});

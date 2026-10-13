import fs from 'node:fs';
import path from 'node:path';
import { BUKIT_PILOT_BBOX } from '../bukit-route-shortlist-paths.js';
import { MAPS_READ_API_BASE } from '../selected-route-paths.js';
import { curlGetToFile } from '../selected-route-curl.js';
import {
  ROUTES_LIST_LIMITS,
  evaluateRoutesOffsetStep,
  backoffMs,
  isTransientHttpStatus,
  shouldNeverRetryRoutesStatus,
} from '../routes-list-pagination.js';
import {
  loadRawPageManifest,
  mergeInventoryFromPages,
} from '../bukit-route-inventory.js';
import {
  buildDriveReferenceMap,
  routeSortKey,
  toRedactedRouteEntry,
} from '../bukit-route-redaction.js';
import { DATA_DIR } from './constants.js';
import { seedRoutesListPages } from './catalog-seed.js';

const RAW_DIR = path.join(DATA_DIR, 'routes-list-raw');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pageFileName(pageNumber, offset) {
  return `page-${String(pageNumber).padStart(3, '0')}-offset-${offset}.json`;
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

export async function fetchFullRouteCatalog(token) {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const serverRequests = [];
  seedRoutesListPages(RAW_DIR, serverRequests);
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

  const pageMetas = loadRawPageManifest(RAW_DIR);
  const merged = mergeInventoryFromPages(pageMetas, (fileName) =>
    fs.readFileSync(path.join(RAW_DIR, fileName))
  );

  const refMap = buildDriveReferenceMap(merged.records);
  const dongleCounts = new Map();
  for (const r of merged.records) {
    dongleCounts.set(r.dongle, (dongleCounts.get(r.dongle) || 0) + 1);
  }
  const redactedCatalog = merged.records.map((r) => {
    const key = routeSortKey(r);
    const entry = toRedactedRouteEntry(r, refMap, {
      activeKeys: new Set(),
      dongleCounts,
    });
    return { route_ref: entry.drive_ref, ...entry };
  });

  return {
    stopReason,
    page_count: pages.length,
    total_records: merged.record_count,
    records: merged.records,
    refMap,
    redactedCatalog,
    serverRequests,
  };
}

/** Cached paginated catalogue on disk (no live API). */
export function loadCachedCatalogRecordByRef() {
  const pageMetas = loadRawPageManifest(RAW_DIR);
  const merged = mergeInventoryFromPages(pageMetas, (fileName) =>
    fs.readFileSync(path.join(RAW_DIR, fileName))
  );
  const refMap = buildDriveReferenceMap(merged.records);
  const recordByRef = new Map();
  for (const r of merged.records) {
    recordByRef.set(refMap.get(routeSortKey(r)), r);
  }
  return { recordByRef, record_count: merged.record_count, refMap };
}

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { ROOT_DIR } from '../src/config.js';
import { sha256Hex } from '../src/lib/json-nan-normalize.js';
import { curlGetToFile } from '../src/lib/selected-route-curl.js';
import {
  BUKIT_PILOT_BBOX,
  SHORTLIST_RAW_DIR,
  PAGINATION_RUN_PRIVATE_PATH,
  MAPS_READ_API_BASE,
} from '../src/lib/bukit-route-shortlist-paths.js';
import {
  ROUTES_LIST_LIMITS,
  evaluateRoutesOffsetStep,
  backoffMs,
  isTransientHttpStatus,
  shouldNeverRetryRoutesStatus,
} from '../src/lib/routes-list-pagination.js';

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function atomicWriteJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

function pageFileName(pageNumber, offset) {
  return `page-${String(pageNumber).padStart(3, '0')}-offset-${offset}.json`;
}

async function downloadPage({ pageNumber, offset, token }) {
  const finalPath = path.join(SHORTLIST_RAW_DIR, pageFileName(pageNumber, offset));
  if (fs.existsSync(finalPath)) {
    const buf = fs.readFileSync(finalPath);
    const page = JSON.parse(buf.toString('utf8'));
    return {
      ok: true,
      skipped: true,
      path: finalPath,
      sha256: sha256Hex(buf),
      byte_size: buf.length,
      page,
      http_status: 200,
    };
  }

  const partPath = `${finalPath}.part`;
  const headerPath = path.join(SHORTLIST_RAW_DIR, `.headers-routes-${pageNumber}.tmp`);
  const url = `${MAPS_READ_API_BASE}/v1/routes?bbox=${BUKIT_PILOT_BBOX}&limit=${ROUTES_LIST_LIMITS.defaultLimit}&offset=${offset}`;

  for (let attempt = 0; attempt <= ROUTES_LIST_LIMITS.maxRetriesTransient; attempt += 1) {
    try {
      const { status } = await curlGetToFile(url, { token, outPath: partPath, headerPath });
      if (shouldNeverRetryRoutesStatus(status)) {
        return { ok: false, stopReason: `http_${status}`, http_status: status };
      }
      if (status >= 400 && isTransientHttpStatus(status) && attempt < ROUTES_LIST_LIMITS.maxRetriesTransient) {
        await sleep(backoffMs(attempt));
        continue;
      }
      if (status < 200 || status >= 300) {
        return { ok: false, stopReason: `http_${status}`, http_status: status };
      }
      const buf = fs.readFileSync(partPath);
      if (buf.length > ROUTES_LIST_LIMITS.maxTotalBytes) {
        return { ok: false, stopReason: 'page_too_large' };
      }
      fs.renameSync(partPath, finalPath);
      if (fs.existsSync(headerPath)) fs.unlinkSync(headerPath);
      const page = JSON.parse(buf.toString('utf8'));
      return {
        ok: true,
        skipped: false,
        path: finalPath,
        sha256: sha256Hex(buf),
        byte_size: buf.length,
        page,
        http_status: status,
      };
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

async function main() {
  const token = (process.env.MAPS_READ_TOKEN || '').trim();
  if (!token) {
    console.error('MAPS_READ_TOKEN missing');
    process.exit(2);
  }

  fs.mkdirSync(SHORTLIST_RAW_DIR, { recursive: true });

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

    const result = await downloadPage({ pageNumber, offset, token });
    if (!result.ok) {
      stopReason = result.stopReason;
      break;
    }

    totalBytes += result.byte_size;
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
      sha256: result.sha256,
      byte_size: result.byte_size,
      http_status: result.http_status,
      skipped: result.skipped,
    });

    if (totalRecords >= ROUTES_LIST_LIMITS.maxRecords) {
      stopReason = 'max_records';
      break;
    }

    const nextOffset = page.next_offset;
    const step = evaluateRoutesOffsetStep({
      returned,
      nextOffset,
      previousOffset: offset,
      seenOffsets,
    });
    if (step.stop) {
      stopReason = step.reason;
      break;
    }
    offset = nextOffset;
    pageNumber += 1;
  }

  if (!stopReason && pageNumber >= ROUTES_LIST_LIMITS.maxPages) stopReason = 'max_pages';

  atomicWriteJson(PAGINATION_RUN_PRIVATE_PATH, {
    completed_at: new Date().toISOString(),
    stop_reason: stopReason,
    page_count: pages.length,
    total_bytes: totalBytes,
    total_records_accumulated: totalRecords,
    pages,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        page_count: pages.length,
        stop_reason: stopReason,
        total_bytes: totalBytes,
        records_accumulated: totalRecords,
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

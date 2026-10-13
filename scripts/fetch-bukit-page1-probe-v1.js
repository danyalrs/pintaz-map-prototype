#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { ROOT_DIR } from '../src/config.js';
import { sha256Hex } from '../src/lib/json-nan-normalize.js';
import { curlGetToFile } from '../src/lib/selected-route-curl.js';
import { validateRawPageBuffer } from '../src/lib/selected-route-page-validate.js';
import {
  PROBE_RAW_DIR,
  PROBE_MANIFEST_PRIVATE_PATH,
  DRIVE_REF_MAP_PRIVATE_PATH,
  probeRawPath,
  MAPS_READ_API_BASE,
} from '../src/lib/bukit-page1-probe-paths.js';
import {
  PAGE1_PROBE_LIMITS,
  backoffMs,
  isTransientHttpStatus,
  shouldNeverRetryProbeStatus,
} from '../src/lib/bukit-page1-probe-limits.js';
import {
  buildDriveRefMapPrivate,
  loadShortlistProbeCandidates,
} from '../src/lib/bukit-page1-probe-shortlist.js';
import { buildGeojsonPage1Url } from '../src/lib/bukit-page1-coverage.js';

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

function expectedIdentity(candidate) {
  return {
    dongle: candidate.dongle,
    route: candidate.route,
    dongle_redacted: candidate.dongle_redacted,
    route_redacted: candidate.route_redacted,
  };
}

async function downloadCandidate(candidate, token) {
  const finalPath = probeRawPath(candidate.probe_ref);
  const partPath = `${finalPath}.part`;
  const headerPath = path.join(PROBE_RAW_DIR, `.headers-${candidate.probe_ref}.tmp`);
  const expectedRoute = expectedIdentity(candidate);

  if (fs.existsSync(finalPath)) {
    const buf = fs.readFileSync(finalPath);
    const validation = validateRawPageBuffer(buf, {
      expectedRoute,
      previousNextAfterSeg: null,
      requestedAfterSeg: null,
    });
    if (validation.ok) {
      return {
        ok: true,
        skipped: true,
        path: finalPath,
        sha256: sha256Hex(buf),
        byte_size: buf.length,
        http_status: 200,
        validation,
        download_time_ms: 0,
      };
    }
  }

  const url = buildGeojsonPage1Url({
    apiBase: MAPS_READ_API_BASE,
    dongle: candidate.dongle,
    route: candidate.route,
  });

  for (let attempt = 0; attempt <= PAGE1_PROBE_LIMITS.maxRetriesTransient; attempt += 1) {
    const started = Date.now();
    try {
      if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
      const { status } = await curlGetToFile(url, {
        token,
        outPath: partPath,
        headerPath,
        maxFilesizeBytes: PAGE1_PROBE_LIMITS.maxSingleResponseBytes,
      });
      if (shouldNeverRetryProbeStatus(status)) {
        return { ok: false, http_status: status, stopReason: `http_${status}`, authFailure: status === 401 || status === 403 };
      }
      if (status >= 400 && isTransientHttpStatus(status) && attempt < PAGE1_PROBE_LIMITS.maxRetriesTransient) {
        await sleep(backoffMs(attempt));
        continue;
      }
      if (status < 200 || status >= 300) {
        return { ok: false, http_status: status, stopReason: `http_${status}` };
      }
      const buf = fs.readFileSync(partPath);
      if (buf.length > PAGE1_PROBE_LIMITS.maxSingleResponseBytes) {
        return { ok: false, stopReason: 'response_too_large', http_status: status };
      }
      const validation = validateRawPageBuffer(buf, {
        expectedRoute,
        previousNextAfterSeg: null,
        requestedAfterSeg: null,
      });
      if (!validation.ok) {
        return {
          ok: false,
          stopReason: 'validation_failed',
          http_status: status,
          anomalies: validation.anomalies,
        };
      }
      fs.renameSync(partPath, finalPath);
      if (fs.existsSync(headerPath)) fs.unlinkSync(headerPath);
      return {
        ok: true,
        skipped: false,
        path: finalPath,
        sha256: sha256Hex(buf),
        byte_size: buf.length,
        http_status: status,
        validation,
        download_time_ms: Date.now() - started,
      };
    } catch (e) {
      if (attempt < PAGE1_PROBE_LIMITS.maxRetriesTransient) {
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

  const candidates = loadShortlistProbeCandidates();
  fs.mkdirSync(PROBE_RAW_DIR, { recursive: true });
  atomicWriteJson(DRIVE_REF_MAP_PRIVATE_PATH, buildDriveRefMapPrivate(candidates));

  let totalBytes = 0;
  const records = [];
  let networkRequestCount = 0;

  for (const candidate of candidates) {
    const finalPath = probeRawPath(candidate.probe_ref);
    let needsNetwork = true;
    if (fs.existsSync(finalPath)) {
      const buf = fs.readFileSync(finalPath);
      const v = validateRawPageBuffer(buf, {
        expectedRoute: expectedIdentity(candidate),
        previousNextAfterSeg: null,
        requestedAfterSeg: null,
      });
      needsNetwork = !v.ok;
    }
    if (needsNetwork) {
      if (networkRequestCount >= PAGE1_PROBE_LIMITS.maxRequests) break;
      if (networkRequestCount > 0) await sleep(PAGE1_PROBE_LIMITS.minDelayMs);
      networkRequestCount += 1;
    }
    const result = await downloadCandidate(candidate, token);

    const rec = {
      probe_ref: candidate.probe_ref,
      inventory_drive_ref: candidate.inventory_drive_ref,
      dongle: candidate.dongle,
      route: candidate.route,
      requested_after_seg: null,
      followed_next_after_seg: false,
      http_status: result.http_status ?? null,
      ok: Boolean(result.ok),
      skipped: Boolean(result.skipped),
      stop_reason: result.stopReason ?? null,
      sha256: result.sha256 ?? null,
      byte_size: result.byte_size ?? 0,
      download_time_ms: result.download_time_ms ?? null,
      truncated: result.validation?.truncated ?? null,
      next_after_seg: result.validation?.nextAfterSeg ?? null,
      feature_count: result.validation?.featureCount ?? null,
      anomalies: result.validation?.anomalies ?? result.anomalies ?? [],
    };
    records.push(rec);
    if (result.ok) totalBytes += rec.byte_size;
    if (totalBytes > PAGE1_PROBE_LIMITS.maxTotalBytes) {
      console.error('total_bytes_exceeded');
      process.exit(3);
    }
    if (result.authFailure) {
      atomicWriteJson(PROBE_MANIFEST_PRIVATE_PATH, {
        completed_at: new Date().toISOString(),
        aborted: true,
        reason: 'authentication_failure',
        records,
        total_bytes: totalBytes,
      });
      process.exit(4);
    }
  }

  atomicWriteJson(PROBE_MANIFEST_PRIVATE_PATH, {
    schema: 'pintaz.bukit-page1-probe.manifest.private',
    version: 1,
    completed_at: new Date().toISOString(),
    network_request_count: networkRequestCount,
    total_bytes: totalBytes,
    records,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        downloads: records.filter((r) => r.ok).length,
        failed: records.filter((r) => !r.ok).length,
        total_bytes: totalBytes,
        skipped: records.filter((r) => r.skipped).length,
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

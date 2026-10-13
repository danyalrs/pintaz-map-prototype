import fs from 'node:fs';
import path from 'node:path';
import { sha256Hex } from './json-nan-normalize.js';
import { routeSortKey } from './bukit-route-redaction.js';
import { PRIOR_COVERAGE_ROUTE_COUNT } from './bukit-route-shortlist-paths.js';

const REQUIRED_ROUTE_FIELDS = ['dongle', 'route', 'version', 'segments', 'model_frames', 'gps_fixes'];

export function parseRoutesPage(buf) {
  return JSON.parse(buf.toString('utf8'));
}

export function validateRouteRecord(r, anomalies) {
  const issues = [];
  if (!r || typeof r !== 'object') {
    issues.push('invalid_route_object');
  } else {
    for (const f of REQUIRED_ROUTE_FIELDS) {
      if (r[f] === undefined || r[f] === null) issues.push(`missing_${f}`);
    }
    if (typeof r.dongle !== 'string' || !/^[0-9a-f]{16}$/.test(r.dongle)) issues.push('invalid_dongle');
    if (typeof r.route !== 'string' || !/^\d{4}-\d{2}-\d{2}--\d{2}-\d{2}-\d{2}$/.test(r.route)) {
      issues.push('invalid_route');
    }
    if (!Number.isFinite(Number(r.model_frames)) || r.model_frames < 0) issues.push('invalid_model_frames');
    if (!Number.isFinite(Number(r.gps_fixes)) || r.gps_fixes < 0) issues.push('invalid_gps_fixes');
  }
  anomalies.push(...issues);
  return issues.length === 0;
}

export function mergeInventoryFromPages(pageMetas, loadPageBuf) {
  const all = [];
  const anomalies = [];
  const duplicatePairs = [];
  const seen = new Map();
  let totalBytes = 0;

  for (const meta of pageMetas) {
    const buf = loadPageBuf(meta.file_name);
    totalBytes += buf.length;
    const page = parseRoutesPage(buf);
    const unexpected = Object.keys(page).filter(
      (k) => !['bbox', 'limit', 'offset', 'returned', 'next_offset', 'routes'].includes(k)
    );
    if (unexpected.length) anomalies.push(`unexpected_page_fields:${unexpected.join(',')}`);

    for (const r of page.routes || []) {
      const local = [];
      validateRouteRecord(r, local);
      if (local.length) anomalies.push(...local.map((x) => `${x}:${r?.route || '?'}`));
      const key = routeSortKey(r);
      if (seen.has(key)) duplicatePairs.push({ first_page: seen.get(key), duplicate: r });
      else {
        seen.set(key, meta.page_number);
        all.push(r);
      }
    }
  }

  return {
    records: all,
    record_count: all.length,
    duplicate_pair_count: duplicatePairs.length,
    duplicate_pairs: duplicatePairs,
    anomalies,
    total_bytes: totalBytes,
    prior_coverage_route_count: PRIOR_COVERAGE_ROUTE_COUNT,
    difference_from_prior_coverage: all.length - PRIOR_COVERAGE_ROUTE_COUNT,
  };
}

export function loadRawPageManifest(rawDir) {
  if (!fs.existsSync(rawDir)) return [];
  return fs
    .readdirSync(rawDir)
    .filter((f) => /^page-\d{3}-offset-\d+\.json$/.test(f) && !f.endsWith('.part'))
    .sort()
    .map((fileName, i) => {
      const buf = fs.readFileSync(path.join(rawDir, fileName));
      const page = parseRoutesPage(buf);
      return {
        page_number: i,
        file_name: fileName,
        sha256: sha256Hex(buf),
        byte_size: buf.length,
        offset: page.offset,
        returned: page.returned,
        next_offset: page.next_offset ?? null,
        http_status: 200,
      };
    });
}

export function validatePaginationContinuity(pageMetas) {
  const issues = [];
  const seen = new Set();
  for (let i = 0; i < pageMetas.length; i += 1) {
    const m = pageMetas[i];
    if (i > 0) {
      const prev = pageMetas[i - 1];
      if (prev.next_offset != null && m.offset !== prev.next_offset) {
        issues.push(`offset_gap:page${i}:expected${prev.next_offset}:got${m.offset}`);
      }
    }
    if (seen.has(m.offset)) issues.push(`offset_repeated:${m.offset}`);
    seen.add(m.offset);
  }
  return issues;
}

export function matchSelectedRoute(records, selected) {
  if (!selected?.dongle || !selected?.route) return null;
  const key = `${selected.dongle}\0${selected.route}`;
  return records.find((r) => routeSortKey(r) === key) || null;
}

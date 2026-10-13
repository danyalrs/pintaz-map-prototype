#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../src/config.js';
import { sha256Hex } from '../src/lib/json-nan-normalize.js';
import { validateRawPageBuffer } from '../src/lib/selected-route-page-validate.js';
import { parseProbePageCollection } from '../src/lib/bukit-page1-parse.js';
import {
  PROBE_RAW_DIR,
  PROBE_MANIFEST_PRIVATE_PATH,
  ROUTE_RESULTS_PRIVATE_PATH,
  RECOMMENDED_ROUTES_PRIVATE_PATH,
  DRIVE_REF_MAP_PRIVATE_PATH,
  PROBE_SUMMARY_REDACTED_PATH,
  ROUTE_RANKINGS_REDACTED_PATH,
  RECOMMENDATION_REDACTED_PATH,
  LATER_PAGE_SCAN_REDACTED_PATH,
  probeRawPath,
} from '../src/lib/bukit-page1-probe-paths.js';
import { loadShortlistProbeCandidates } from '../src/lib/bukit-page1-probe-shortlist.js';
import {
  assignProbeStatus,
  loadActiveRouteVehicleGrid,
  measurePage1PilotCoverage,
} from '../src/lib/bukit-page1-coverage.js';
import { buildRankings, recommendRoutesForFullPagination } from '../src/lib/bukit-page1-recommendation.js';
import { containsFullDongle } from '../src/lib/bukit-route-redaction.js';
import { resolveUpdatePreviewPaths } from '../src/lib/update-preview-paths.js';

const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'bukit_route_page1_probe_v1');

function atomicWriteJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

function writeReport(name, content) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, name), content, 'utf8');
}

function redactRouteResult(priv) {
  return {
    probe_ref: priv.probe_ref,
    inventory_drive_ref: priv.inventory_drive_ref,
    probe_status: priv.probe_status,
    http_status: priv.http_status,
    byte_size: priv.byte_size,
    sha256_prefix: priv.sha256 ? `${priv.sha256.slice(0, 12)}…` : null,
    feature_count: priv.feature_count,
    truncated: priv.truncated,
    next_after_seg: priv.next_after_seg,
    next_page_followed: false,
    literal_nan_count: priv.literal_nan_count,
    metrics: priv.metrics,
    download_time_ms: priv.download_time_ms,
    count_scope: 'page_1_only',
  };
}

function main() {
  const candidates = loadShortlistProbeCandidates();
  const manifest = fs.existsSync(PROBE_MANIFEST_PRIVATE_PATH)
    ? JSON.parse(fs.readFileSync(PROBE_MANIFEST_PRIVATE_PATH, 'utf8'))
    : { records: [] };
  const manifestByRef = new Map((manifest.records || []).map((r) => [r.probe_ref, r]));
  const previewPaths = resolveUpdatePreviewPaths();
  const activePreviewPath = previewPaths.previewPath;
  const activeGrid = loadActiveRouteVehicleGrid(activePreviewPath);

  const routeResultsPrivate = [];

  for (const c of candidates) {
    const rawPath = probeRawPath(c.probe_ref);
    const manifestRec = manifestByRef.get(c.probe_ref);
    const base = {
      probe_ref: c.probe_ref,
      inventory_drive_ref: c.inventory_drive_ref,
      dongle: c.dongle,
      route: c.route,
      dongle_redacted: c.dongle_redacted,
      route_redacted: c.route_redacted,
    };
    if (!fs.existsSync(rawPath)) {
      const stop = manifestRec?.stop_reason || 'missing_raw';
      routeResultsPrivate.push({
        ...base,
        http_status: manifestRec?.http_status ?? null,
        ok: false,
        probe_status: stop === 'response_too_large' ? 'request_failed' : 'request_failed',
        stop_reason: stop,
        metrics: null,
        feature_count: 0,
        truncated: null,
        next_after_seg: null,
      });
      continue;
    }
    const buf = fs.readFileSync(rawPath);
    const expectedRoute = {
      dongle: c.dongle,
      route: c.route,
      dongle_redacted: c.dongle_redacted,
      route_redacted: c.route_redacted,
    };
    const validation = validateRawPageBuffer(buf, {
      expectedRoute,
      previousNextAfterSeg: null,
      requestedAfterSeg: null,
    });
    const collection = parseProbePageCollection(buf);
    const features = collection.features || [];
    const metrics = measurePage1PilotCoverage(features, activeGrid);
    const probe_status = assignProbeStatus(metrics, {
      httpOk: true,
      validationOk: validation.ok,
    });

    routeResultsPrivate.push({
      ...base,
      http_status: 200,
      ok: true,
      sha256: sha256Hex(buf),
      byte_size: buf.length,
      feature_count: features.length,
      truncated: validation.truncated,
      next_after_seg: validation.nextAfterSeg,
      literal_nan_count: validation.literalNanCount,
      validation_anomalies: validation.anomalies,
      probe_status,
      metrics,
    });
  }

  const rankingsPrivate = buildRankings(routeResultsPrivate);
  const { recommended, later_page_scan_needed } = recommendRoutesForFullPagination(routeResultsPrivate);

  atomicWriteJson(ROUTE_RESULTS_PRIVATE_PATH, {
    schema: 'pintaz.bukit-page1-probe.route-results.private',
    version: 1,
    active_preview_grid_source: 'complete_selected_route_preview',
    routes: routeResultsPrivate,
  });

  atomicWriteJson(RECOMMENDED_ROUTES_PRIVATE_PATH, {
    schema: 'pintaz.bukit-page1-probe.recommended.private',
    version: 1,
    max_recommendations: 3,
    routes: recommended.map((r) => ({
      probe_ref: r.probe_ref,
      dongle: r.dongle,
      route: r.route,
      recommendation_reason: r.recommendation_reason,
      probe_status: r.probe_status,
      metrics: r.metrics,
    })),
    later_page_scan_needed,
  });

  const summaryRedacted = {
    schema: 'pintaz.bukit-page1-probe.summary.redacted',
    version: 1,
    route_count: routeResultsPrivate.length,
    successful_downloads: routeResultsPrivate.filter((r) => r.ok).length,
    failed_downloads: routeResultsPrivate.filter((r) => !r.ok).length,
    total_bytes: routeResultsPrivate.reduce((s, r) => s + (r.byte_size || 0), 0),
    routes: routeResultsPrivate.map(redactRouteResult),
  };

  const rankingsRedacted = {
    schema: 'pintaz.bukit-page1-probe.rankings.redacted',
    version: 1,
    rankings: Object.fromEntries(
      Object.entries(rankingsPrivate).map(([k, list]) => [
        k,
        list.map((r) => redactRouteResult(r)),
      ])
    ),
  };

  const recommendationRedacted = {
    schema: 'pintaz.bukit-page1-probe.recommendation.redacted',
    version: 1,
    routes: recommended.map((r) => ({
      probe_ref: r.probe_ref,
      inventory_drive_ref: r.inventory_drive_ref,
      probe_status: r.probe_status,
      recommendation_reason: r.recommendation_reason,
      metrics: r.metrics,
    })),
  };

  const laterRedacted = {
    schema: 'pintaz.bukit-page1-probe.later-page-scan.redacted',
    version: 1,
    routes: later_page_scan_needed,
  };

  atomicWriteJson(PROBE_SUMMARY_REDACTED_PATH, summaryRedacted);
  atomicWriteJson(ROUTE_RANKINGS_REDACTED_PATH, rankingsRedacted);
  atomicWriteJson(RECOMMENDATION_REDACTED_PATH, recommendationRedacted);
  atomicWriteJson(LATER_PAGE_SCAN_REDACTED_PATH, laterRedacted);

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.copyFileSync(PROBE_SUMMARY_REDACTED_PATH, path.join(REPORT_DIR, 'probe_summary.redacted.json'));
  fs.copyFileSync(ROUTE_RANKINGS_REDACTED_PATH, path.join(REPORT_DIR, 'route_rankings.redacted.json'));
  fs.copyFileSync(RECOMMENDATION_REDACTED_PATH, path.join(REPORT_DIR, 'recommendation.redacted.json'));

  const recLines = recommended
    .map((r) => `- **${r.probe_ref}**: ${r.recommendation_reason}`)
    .join('\n');
  const laterLines = later_page_scan_needed.map((r) => `- ${r.probe_ref}: ${r.note}`).join('\n');

  writeReport(
    'FINAL_REPORT.md',
    `# Bukit candidate page-1 probe V1\n\n- Candidates probed: **10**\n- Successful page-1 downloads: **${summaryRedacted.successful_downloads}**\n- Failed: **${summaryRedacted.failed_downloads}**\n- Total bytes: **${summaryRedacted.total_bytes}**\n- Recommended for full pagination: **${recommended.length}**\n- Later-page scan needed: **${later_page_scan_needed.length}**\n`
  );
  writeReport('DOWNLOAD_AUDIT.md', `# Download audit\n\nSee probe_manifest (private) and probe_summary.redacted.json.\n`);
  writeReport('PAGE1_COVERAGE.md', `# Page-1 coverage\n\nPer-route metrics in probe_summary.redacted.json.\n`);
  writeReport('SPATIAL_NOVELTY.md', `# Spatial novelty (50 m grid)\n\nNovel vs active complete route grid cells per candidate in metrics.\n`);
  writeReport('ROUTE_RECOMMENDATION.md', `# Recommendations\n\n${recLines || '_None_'}\n`);
  writeReport(
    'LIMITATIONS.md',
    `# Limitations\n\n- Page 1 only; \`no_pilot_points_on_page1\` is inconclusive.\n- 50 m grid is diagnostic only.\n- Per-route counts are page-1 observations only.\n\n## Later page scan\n${laterLines || '_None_'}\n`
  );
  writeReport('commands.txt', `node scripts/fetch-bukit-page1-probe-v1.js\nnode scripts/build-bukit-page1-probe-v1.js\n`);
  writeReport(
    'manifest.json',
    `${JSON.stringify({ task: 'bukit_route_page1_probe_v1', generated_at: new Date().toISOString() }, null, 2)}\n`
  );

  const redactedBlob = JSON.stringify(summaryRedacted);
  if (containsFullDongle(redactedBlob)) {
    throw new Error('redacted_summary_leaked_dongle');
  }

  console.log(JSON.stringify({ ok: true, recommended: recommended.length, later: later_page_scan_needed.length }, null, 2));
}

main();

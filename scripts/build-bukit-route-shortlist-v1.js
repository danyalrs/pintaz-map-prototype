#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../src/config.js';
import {
  SHORTLIST_RAW_DIR,
  INVENTORY_PRIVATE_PATH,
  SHORTLIST_PRIVATE_PATH,
  SHORTLIST_REDACTED_PATH,
  RANKINGS_REDACTED_PATH,
  PRIOR_COVERAGE_ROUTE_COUNT,
  BUKIT_PILOT_BBOX,
} from '../src/lib/bukit-route-shortlist-paths.js';
import {
  loadRawPageManifest,
  mergeInventoryFromPages,
  validatePaginationContinuity,
  matchSelectedRoute,
} from '../src/lib/bukit-route-inventory.js';
import { buildAllRankings } from '../src/lib/bukit-route-rankings.js';
import { buildDeterministicShortlist, atomicWriteJson } from '../src/lib/bukit-route-shortlist-build.js';
import { ROUTES_API_SEMANTICS } from '../src/lib/bukit-route-api-semantics.js';
import { routeSortKey } from '../src/lib/bukit-route-redaction.js';
import { ROUTE_SELECTION_PRIVATE_PATH } from '../src/lib/update-preview-paths.js';

const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'bukit_route_shortlist_v1');

function writeReport(name, content) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, name), content, 'utf8');
}

function main() {
  const pageMetas = loadRawPageManifest(SHORTLIST_RAW_DIR);
  if (!pageMetas.length) {
    console.error('no_raw_pages');
    process.exit(1);
  }

  const paginationIssues = validatePaginationContinuity(pageMetas);
  const merged = mergeInventoryFromPages(pageMetas, (fileName) =>
    fs.readFileSync(path.join(SHORTLIST_RAW_DIR, fileName))
  );

  const selected = fs.existsSync(ROUTE_SELECTION_PRIVATE_PATH)
    ? JSON.parse(fs.readFileSync(ROUTE_SELECTION_PRIVATE_PATH, 'utf8')).selected
    : null;
  const activeMatch = matchSelectedRoute(merged.records, selected);
  const activeKey = selected ? routeSortKey(selected) : null;
  const activeKeys = activeKey ? new Set([activeKey]) : new Set();

  atomicWriteJson(INVENTORY_PRIVATE_PATH, {
    schema: 'pintaz.bukit-route-inventory.private',
    version: 1,
    bbox: BUKIT_PILOT_BBOX,
    page_count: pageMetas.length,
    record_count: merged.record_count,
    duplicate_pair_count: merged.duplicate_pair_count,
    anomalies: merged.anomalies,
    pagination_issues: paginationIssues,
    pages: pageMetas,
    selected_route_in_inventory: Boolean(activeMatch),
    records: merged.records,
  });

  const rankings = buildAllRankings(merged.records, { activeKeys });
  atomicWriteJson(RANKINGS_REDACTED_PATH, {
    schema: 'pintaz.bukit-route-rankings.redacted',
    version: 1,
    count_scope: 'unknown',
    rankings,
  });

  const shortlist = buildDeterministicShortlist(merged.records, { activeKey });
  atomicWriteJson(SHORTLIST_PRIVATE_PATH, shortlist.private);
  atomicWriteJson(SHORTLIST_REDACTED_PATH, shortlist.redacted);

  const inventorySummary = {
    record_count: merged.record_count,
    page_count: pageMetas.length,
    prior_coverage_routes: PRIOR_COVERAGE_ROUTE_COUNT,
    difference_from_prior: merged.difference_from_prior_coverage,
    duplicate_pairs: merged.duplicate_pair_count,
    invalid_anomaly_count: merged.anomalies.length,
    pagination_issue_count: paginationIssues.length,
    selected_route_found: Boolean(activeMatch),
  };

  writeReport('inventory_summary.json', `${JSON.stringify(inventorySummary, null, 2)}\n`);
  fs.copyFileSync(SHORTLIST_REDACTED_PATH, path.join(REPORT_DIR, 'shortlist.redacted.json'));
  fs.copyFileSync(RANKINGS_REDACTED_PATH, path.join(REPORT_DIR, 'rankings.redacted.json'));

  writeReport(
    'API_SEMANTICS.md',
    `# API semantics\n\n\`\`\`json\n${JSON.stringify(ROUTES_API_SEMANTICS, null, 2)}\n\`\`\`\n`
  );

  writeReport(
    'PAGINATION_AUDIT.md',
    `# Pagination audit\n\n- Pages: ${pageMetas.length}\n- Issues: ${paginationIssues.length}\n\n\`\`\`json\n${JSON.stringify({ paginationIssues, pages: pageMetas }, null, 2)}\n\`\`\`\n`
  );

  writeReport(
    'ROUTE_RANKINGS.md',
    `# Route rankings (redacted)\n\nSee rankings.redacted.json for full tables.\n\nTop model_frames: ${rankings.highest_model_frames.slice(0, 5).map((r) => r.drive_ref).join(', ')}\n`
  );

  writeReport(
    'SHORTLIST.md',
    `# Shortlist\n\n${shortlist.redacted.routes.map((r) => `- ${r.drive_ref}: ${r.selection_reason}`).join('\n')}\n`
  );

  writeReport(
    'FINAL_REPORT.md',
    `# Bukit route shortlist V1\n\n- Inventory routes: **${merged.record_count}**\n- Prior /v1/coverage routes: **${PRIOR_COVERAGE_ROUTE_COUNT}**\n- Difference: **${merged.difference_from_prior_coverage}**\n- Shortlist size: **${shortlist.redacted.routes.length}**\n`
  );

  writeReport(
    'NEXT_PROBE_PLAN.md',
    `# Next probe plan (not executed)\n\n1. Fetch page 1 GeoJSON only for each shortlisted route (max 10).\n2. Measure observations inside the 2 km Bukit pilot square (vehicle_pose, lane_point, edge_point).\n3. Rank by inside coverage; select up to 3 routes for full pagination.\n4. Process each drive independently; never merge observations across routes.\n5. Re-run mismatch only after per-drive matching; aggregate support counts without fusing geometries.\n`
  );

  writeReport(
    'commands.txt',
    `node scripts/fetch-bukit-route-shortlist-v1.js\nnode scripts/build-bukit-route-shortlist-v1.js\n`
  );
  writeReport(
    'manifest.json',
    `${JSON.stringify({ generated_at: new Date().toISOString(), task: 'bukit_route_shortlist_v1' }, null, 2)}\n`
  );

  console.log(JSON.stringify({ ok: true, ...inventorySummary }, null, 2));
}

main();

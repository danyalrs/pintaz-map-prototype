#!/usr/bin/env node
/**
 * Phase 2 resume: probe live API, then index vehicle_pose or emit retry-only report.
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { ROOT_DIR } from '../src/config.js';
import {
  probeLiveMapsReadApi,
  loadPhase2ProgressSummary,
} from '../src/lib/full-maps-read-route-enrichment-discovery/probe-live-api.js';
import { POINT_ONLY_LANE_COUNT_STATEMENT } from '../src/lib/full-maps-read-route-enrichment-discovery/eligibility.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'full_maps_read_route_enrichment_discovery_v1');

function writeText(p, t) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, t, 'utf8');
}

function writeJson(p, o) {
  writeText(p, `${JSON.stringify(o, null, 2)}\n`);
}

function writeRetryReport(probe, progress) {
  const md = `# Phase 2 retry — live Maps Read unavailable

**Stop reason:** \`${probe.stop_reason}\`  
**Probed at (UTC):** ${probe.probed_at}  
**GET /health:** HTTP ${probe.health_http_status}  
**GET /v1/geojson (vehicle_pose probe):** HTTP ${probe.geojson_probe_http_status ?? 'skipped'}

## Indexing state (checkpoint preserved)

| Metric | Count |
|--------|------:|
| Catalogue routes (Bukit bbox) | ${progress.catalog_route_count} |
| Routes in checkpoint (prior partial index) | ${progress.routes_indexed_in_checkpoint} |
| Routes not yet indexed (live API) | ${progress.routes_not_yet_indexed} |

No routes were marked completed or uncovered during this run. The checkpoint under \`data/maps-read/full-route-enrichment-discovery-v1/discovery-progress.json\` was not modified.

Prior report conclusions are unchanged. No local-preview fallback was applied.

## Point-only lane data

${POINT_ONLY_LANE_COUNT_STATEMENT}

## Next single action

Re-run when Maps Read returns HTTP 2xx on both probes:

\`\`\`
node scripts/resume-full-maps-read-route-enrichment-discovery-v1-phase2.js
\`\`\`
`;
  writeText(path.join(REPORT_DIR, 'PHASE2_RETRY_REPORT.md'), md);
  writeJson(path.join(REPORT_DIR, 'phase2_indexing_progress.json'), {
    updated_at: probe.probed_at,
    stop_reason: probe.stop_reason,
    health_http_status: probe.health_http_status,
    geojson_probe_http_status: probe.geojson_probe_http_status,
    ...progress,
    routes_failed_fetch_this_run: 0,
    checkpoint_modified: false,
  });
  writeJson(path.join(REPORT_DIR, 'validation.json'), {
    phase2_probe_at: probe.probed_at,
    live_api_healthy: false,
    stop_reason: probe.stop_reason,
    maps_read_writes: false,
    osm_writes: false,
    production_route_activated: false,
    checkpoint_preserved: true,
  });
}

async function main() {
  const token = (process.env.MAPS_READ_TOKEN || '').trim();
  if (!token) {
    console.error('MAPS_READ_TOKEN missing');
    process.exit(2);
  }

  const probe = await probeLiveMapsReadApi(token);
  const progress = loadPhase2ProgressSummary();

  if (!probe.live_api_healthy) {
    writeRetryReport(probe, progress);
    console.log('live_api_unavailable', probe.stop_reason, probe.health_http_status, probe.geojson_probe_http_status);
    process.exit(0);
  }

  process.env.FULL_DISCOVERY_LIVE_API_ONLY = '1';
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, ['scripts/run-full-maps-read-route-enrichment-discovery-v1.js'], {
    cwd: ROOT_DIR,
    env: { ...process.env, FULL_DISCOVERY_LIVE_API_ONLY: '1' },
    stdio: 'inherit',
  });
  process.exit(r.status ?? 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { ROOT_DIR } from '../src/config.js';
import { runFullMapsReadRouteEnrichmentDiscovery } from '../src/lib/full-maps-read-route-enrichment-discovery/index.js';

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

async function main() {
  const token = (process.env.MAPS_READ_TOKEN || '').trim();
  if (!token) {
    console.error('MAPS_READ_TOKEN missing');
    process.exit(2);
  }

  const result = await runFullMapsReadRouteEnrichmentDiscovery({ token });

  writeJson(path.join(REPORT_DIR, 'route_catalog.redacted.json'), {
    schema: result.version,
    pagination_stop_reason: result.catalog.pagination_stop_reason,
    total_server_routes: result.catalog.total_server_routes,
    routes: result.redacted.route_catalog,
  });
  writeJson(path.join(REPORT_DIR, 'unknown_way_coverage.redacted.json'), {
    schema: result.version,
    rows: result.redacted.unknown_way_coverage,
    target_ways: {
      jalan_kamuning: result.target_way_rows.jalan_kamuning_39914067,
      lorong_kuda: result.target_way_rows.lorong_kuda_706737045,
    },
  });
  writeJson(path.join(REPORT_DIR, 'route_road_ranking.redacted.json'), {
    schema: result.version,
    pairs: result.redacted.route_road_ranking,
  });
  writeJson(path.join(REPORT_DIR, 'qualification_results.redacted.json'), {
    schema: result.version,
    results: result.redacted.qualification_results,
    lane_enrichment_candidate_permitted: result.lane_enrichment_candidate_permitted,
  });
  writeJson(path.join(REPORT_DIR, 'server_requests.redacted.json'), {
    schema: result.version,
    requests: result.redacted.server_requests,
  });
  writeJson(path.join(REPORT_DIR, 'validation.json'), {
    ...result.phase0,
    maps_read_api_called: true,
    maps_read_host_status: result.maps_read_host_status ?? null,
    maps_read_writes: false,
    osm_writes: false,
    production_route_activated: false,
    geojson_parse_summary: result.geojson_parse_summary ?? null,
  });
  writeJson(path.join(REPORT_DIR, 'geojson_parse_summary.redacted.json'), {
    schema: result.version,
    ...(result.geojson_parse_summary ?? {}),
  });

  writeText(
    path.join(REPORT_DIR, 'ROUTE_CATALOG_SUMMARY.md'),
    `# Route catalogue summary

- **Total server routes (Bukit bbox):** ${result.catalog.total_server_routes}
- **Pagination stop:** \`${result.catalog.pagination_stop_reason}\`
- **Pages:** ${result.catalog.page_count}
`
  );

  writeText(
    path.join(REPORT_DIR, 'UNKNOWN_OSM_ROUTE_COVERAGE.md'),
    `# Unknown OSM lane route coverage

- Unknown-lane OSM ways: ${result.unknown_lane_way_count}
- Ways with ≥1 server route observation: ${result.unknown_lane_ways_with_server_coverage}

## Jalan Kamuning (39914067)

${JSON.stringify(result.target_way_rows.jalan_kamuning_39914067, null, 2)}

## Lorong Kuda (706737045)

${JSON.stringify(result.target_way_rows.lorong_kuda_706737045, null, 2)}

Not lane alignment — OSM lane count missing.
`
  );

  writeText(
    path.join(REPORT_DIR, 'ROUTE_ROAD_RANKING.md'),
    `# Route–road ranking (top 25)

${result.redacted.route_road_ranking
  .slice(0, 25)
  .map((r) => `- ${r.route_ref} × ${r.osm_way_id} score=${r.ranking_score} poses=${r.matched_pose_count}`)
  .join('\n')}
`
  );

  writeText(
    path.join(REPORT_DIR, 'ROUTE_QUALIFICATION_RESULTS.md'),
    `# Route qualification (point-only, per-route LOO)

${result.lane_enrichment_note}

${result.qualification.map((q) => `- **${q.route_ref}**: ${q.route_verdict} (labelled ways ${q.labelled_ways_on_route})`).join('\n')}
`
  );

  writeText(
    path.join(REPORT_DIR, 'FINAL_REPORT.md'),
    `# Full Maps Read route enrichment discovery V1

Read-only discovery against documented \`GET /v1/routes\` and \`GET /v1/geojson\` (vehicle_pose, then lane/edge for top routes).

- Server routes catalogued: **${result.catalog.total_server_routes}**
- Unknown-lane ways with coverage: **${result.unknown_lane_ways_with_server_coverage}**
- Lane enrichment candidate permitted: **${result.lane_enrichment_candidate_permitted}**
- Live Maps Read geojson during run: **${result.maps_read_host_status}**

${result.lane_enrichment_note}

Pose index progress: **${result.pose_index_routes_processed}** / **${result.catalog.total_server_routes}** catalogue routes with vehicle_pose observations indexed (live \`GET /v1/geojson\` where available).

No OSM/UI/production route activation.

## GeoJSON parse boundary

- Normalised non-standard numeric tokens: **${result.geojson_parse_summary?.normalized_numeric_token_replacements ?? 0}**
- Malformed observations dropped: **${result.geojson_parse_summary?.malformed_observations_dropped ?? 0}**
- Malformed / retryable routes: **${(result.geojson_parse_summary?.malformed_retryable_route_refs ?? []).length}**

${result.geojson_parse_summary?.point_only_statement ?? ''}

Null or invalid numeric values are never used as lane or pose evidence.
`
  );

  writeText(
    path.join(REPORT_DIR, 'commands.txt'),
    `cd C:\\Pintaz-Map-Prototype
node scripts/run-full-maps-read-route-enrichment-discovery-v1.js
`
  );

  console.log('routes', result.catalog.total_server_routes);
  console.log('Wrote', REPORT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

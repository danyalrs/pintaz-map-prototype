#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ROOT_DIR } from '../src/config.js';
import { verifyProtectedInputHashes, readGitHead } from '../src/lib/multi-drive-rebuild-guard.js';
import {
  ADAPTER_VERSION,
  ADAPTER_BOUNDARY_STATEMENT,
  FIXTURE_CASES,
  runMapsReadPolylineEndToEnd,
} from '../src/lib/maps-read-polyline-adapter/index.js';

const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'maps_read_polyline_adapter_v1');

const REQUIRED_STATEMENT =
  'The adapter is ready for a future Maps Read ordered-polyline export. Current `/v1/geojson` point-only data is rejected and cannot enter lane-count enrichment.';

function writeText(p, t) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, t, 'utf8');
}

function writeJson(p, o) {
  writeText(p, `${JSON.stringify(o, null, 2)}\n`);
}

function runCase(fn) {
  const pair = fn();
  return runMapsReadPolylineEndToEnd(pair.server, pair.context ?? undefined);
}

function main() {
  const head = readGitHead(ROOT_DIR);
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  const protected_hashes = verifyProtectedInputHashes(ROOT_DIR);

  const results = {};
  for (const [key, fn] of Object.entries(FIXTURE_CASES)) {
    results[key] = runCase(fn);
  }
  results.missing_context = runMapsReadPolylineEndToEnd(FIXTURE_CASES.A().server, null);

  writeJson(path.join(REPORT_DIR, 'end_to_end_results.json'), {
    schema: ADAPTER_VERSION,
    required_statement: REQUIRED_STATEMENT,
    boundary_statement: ADAPTER_BOUNDARY_STATEMENT,
    cases: results,
  });

  writeText(
    path.join(REPORT_DIR, 'ADAPTER_CONTRACT.md'),
    `# Maps Read polyline adapter V1.1 — split contracts

${ADAPTER_BOUNDARY_STATEMENT}

## A. Future Maps Read polyline export (observations only)

- \`metadata.schema\`: \`kommu.maps.lane_polyline_export\`
- \`metadata.route_key\`, \`metadata.coordinate_frame\`
- \`LineString\` features: \`lane_boundary\` | \`road_edge\` with \`line_id\`, \`probability\`, ordered local coordinates
- \`vehicle_pose\` features: \`frame_id\`, \`timestamp\`, \`pose\` / heading

Maps Read must **not** supply OSM way id, lane count, one-way tag, cross-section, or enrichment decisions.

## B. Pintaz local OSM enrichment context

- \`pintaz.osm-enrichment-context.v1\`
- \`osm_way_id\`, \`osm_road\` (centreline, one-way), \`cross_section\`, \`pose_match_by_frame_id\`

## API

\`adaptMapsReadPolylineExport(serverExport, osmEnrichmentContext)\` → full input bundle → contract validator → core.

Rejections: \`unsupported_point_only\`, \`missing_osm_enrichment_context\`, \`real_route_disabled\`.

${REQUIRED_STATEMENT}
`
  );

  writeText(
    path.join(REPORT_DIR, 'FINAL_REPORT.md'),
    `# Maps Read polyline adapter V1.1

${ADAPTER_BOUNDARY_STATEMENT}

${REQUIRED_STATEMENT}

## Synthetic end-to-end cases

| Case | Result |
|------|--------|
| A one-lane | \`${results.A.algorithm_decision}\`, count \`${results.A.selected_lane_count}\` |
| B three-lane | \`${results.B.algorithm_decision}\`, count \`${results.B.selected_lane_count}\` |
| C point-only | \`${results.C.contract_outcome}\` |
| D bad vertices | \`${results.D.contract_outcome}\` |
| E conflict | \`${results.E.algorithm_decision}\`, \`${results.E.note}\` |
| missing context | \`${results.missing_context.contract_outcome}\` |

HEAD: \`${head}\` (\`${branch}\`)
`
  );

  writeJson(path.join(REPORT_DIR, 'validation.json'), {
    protected_hashes_ok: protected_hashes.ok === true,
    head,
    branch,
    adapter_version: ADAPTER_VERSION,
    maps_read_api_called: false,
    production_routes_enabled: false,
    split_contract_v1_1: true,
  });

  writeText(
    path.join(REPORT_DIR, 'commands.txt'),
    `cd C:\\Pintaz-Map-Prototype
node scripts/run-maps-read-polyline-adapter-v1.js
npm test -- tests/maps-read-polyline-adapter.test.js
`
  );

  console.log('Wrote', REPORT_DIR);
}

main();

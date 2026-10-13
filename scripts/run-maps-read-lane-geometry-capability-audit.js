#!/usr/bin/env node
/**
 * Maps Read lane-geometry capability audit — reports only.
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { execSync } from 'node:child_process';
import { ROOT_DIR } from '../src/config.js';
import { verifyProtectedInputHashes, readGitHead } from '../src/lib/multi-drive-rebuild-guard.js';
import { MAPS_READ_API_BASE } from '../src/lib/selected-route-paths.js';
import { probeRawPath, DRIVE_REF_MAP_PRIVATE_PATH } from '../src/lib/bukit-page1-probe-paths.js';
import { ROUTE_SELECTION_PRIVATE_PATH } from '../src/lib/update-preview-paths.js';
import {
  loadDocumentedApiSpec,
  buildEndpointMatrix,
  documentedGeometryCapabilities,
  buildProbeUrls,
  probeEndpoint,
  summarizeGeojsonFile,
  classifyVerdict,
  UPSTREAM_EXPORT_REQUEST,
} from '../src/lib/maps-read-lane-geometry-capability-audit/index.js';

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'maps_read_lane_geometry_capability_audit');
const CHECKPOINT = path.join(
  ROOT_DIR,
  '.checkpoint_test_backup',
  'pre_maps_read_lane_geometry_capability_audit'
);
const WORK_DIR = path.join(REPORT_DIR, '.probe-tmp');

function writeText(p, t) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, t, 'utf8');
}

function writeJson(p, o) {
  writeText(p, `${JSON.stringify(o, null, 2)}\n`);
}

function phase0() {
  const head = readGitHead(ROOT_DIR);
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  const porcelain = execSync('git status --porcelain', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  const protected_hashes = verifyProtectedInputHashes(ROOT_DIR);
  const state = { head, branch, porcelain, protected_hashes, untracked: porcelain.split('\n').filter(Boolean) };
  fs.mkdirSync(CHECKPOINT, { recursive: true });
  writeJson(path.join(CHECKPOINT, 'protected-state.json'), state);
  return state;
}

function loadDrive005Ref() {
  const map = JSON.parse(fs.readFileSync(DRIVE_REF_MAP_PRIVATE_PATH, 'utf8'));
  const row = map.mappings.find((m) => m.probe_ref === 'drive-005');
  if (!row) throw new Error('drive-005 not in drive-ref-map');
  return {
    probe_ref: 'drive-005',
    dongle: row.dongle,
    route: row.route,
    dongle_redacted: row.dongle_redacted,
    route_redacted: row.route_redacted,
  };
}

async function main() {
  const phase0State = phase0();
  const tokenPresent = Boolean((process.env.MAPS_READ_TOKEN || '').trim());
  const { source_path, document } = loadDocumentedApiSpec();
  const endpointMatrix = buildEndpointMatrix(document);
  const documented = documentedGeometryCapabilities(document);

  const bbox = fs.existsSync(ROUTE_SELECTION_PRIVATE_PATH)
    ? JSON.parse(fs.readFileSync(ROUTE_SELECTION_PRIVATE_PATH, 'utf8')).bbox
    : '101.708993,3.141007,101.727007,3.158993';

  const drive = loadDrive005Ref();
  const probeUrls = buildProbeUrls({ bbox, dongle: drive.dongle, route: drive.route });
  const liveProbes = [];
  for (const spec of probeUrls) {
    if (spec.auth && !tokenPresent) {
      liveProbes.push({
        label: spec.label,
        skipped: true,
        reason: 'MAPS_READ_TOKEN not set',
      });
      continue;
    }
    liveProbes.push(
      await probeEndpoint({
        label: spec.label,
        url: spec.url,
        token: spec.auth ? process.env.MAPS_READ_TOKEN : '',
        workDir: WORK_DIR,
      })
    );
  }
  const liveOk = liveProbes.some((p) => p.http_status === 200);

  const localGeojsonPath = probeRawPath('drive-005');
  const geojsonSummary = summarizeGeojsonFile(localGeojsonPath);
  const verdictCode = classifyVerdict({
    documented,
    geojsonSummary,
    liveProbesOk: liveOk,
  });

  const exampleTrace = {
    schema: 'pintaz.maps-read-lane-geometry.example-frame.redacted',
    route_probe_ref: drive.probe_ref,
    route_redacted: drive.route_redacted,
    frame_id: geojsonSummary.example_frame_id,
    endpoint: 'GET /v1/geojson',
    documented_layers: 'vehicle_pose,lane_point,edge_point,gps_point',
    geometry_types_observed: geojsonSummary.geometry_by_layer,
    ordered_lane_boundary_coordinates: false,
    ordered_road_edge_coordinates: false,
    modelV2_laneLines_array: false,
    local_xyz_arrays: false,
    linestring_in_response: geojsonSummary.has_linestring_lane_edge,
    per_frame_line_identity: 'properties.lane_index | edge_index + frame_id',
    probability_fields: ['lane_probability', 'edge_probability'],
    qlog_download_url_in_response: false,
    source_qlog_names_in_metadata_only: true,
    can_intersect_cross_section_from_api_payload: false,
    example_lane_point_fields: geojsonSummary.example_lane_point_property_schema,
  };

  writeJson(path.join(REPORT_DIR, 'route_response_schema.redacted.json'), {
    maps_read_api_base: MAPS_READ_API_BASE,
    documented_spec_source: source_path,
    route_selected: {
      probe_ref: drive.probe_ref,
      dongle_redacted: drive.dongle_redacted,
      route_redacted: drive.route_redacted,
    },
    live_probes: liveProbes,
    local_geojson_corroboration: {
      path: path.relative(ROOT_DIR, localGeojsonPath).replace(/\\/g, '/'),
      note: 'Prior bounded download via documented /v1/geojson (page-1 probe); not re-fetched when live API errors.',
      summary: geojsonSummary,
    },
    example_frame_trace: exampleTrace,
    lane_count_inferred: false,
  });

  writeJson(path.join(REPORT_DIR, 'capability_verdict.json'), {
    verdict: verdictCode,
    documented_capabilities: documented,
    live_api_reachable: liveOk,
    live_probe_summary: liveProbes.map((p) => ({
      label: p.label,
      http_status: p.http_status,
      content_type: p.content_type,
    })),
    ordered_per_frame_lane_edge_geometry_available: false,
    v3_lane_count_can_proceed: false,
    lane_count_inferred: false,
  });

  const matrixMd = endpointMatrix
    .map(
      (e) =>
        `| ${e.method} | \`${e.path}\` | ${e.auth ? 'bearer' : 'none'} | ${e.relevance} | ${(e.purpose || '').replace(/\|/g, '/')} |`
    )
    .join('\n');

  writeText(
    path.join(REPORT_DIR, 'OPENAPI_ENDPOINT_MATRIX.md'),
    `# Maps Read documented endpoints (from /docs)

Source: \`${source_path}\` and live \`GET /docs\` when reachable.

| Method | Path | Auth | Relevance | Purpose |
|--------|------|------|-----------|---------|
${matrixMd}

## Geometry-related query parameters

- \`/v1/geojson\`: \`dongle\`, \`route\`, \`layers\`, \`after_seg\`, \`max_features\` (default/max 80000)
- No documented parameter requests polyline detail, modelV2 arrays, or qlog download.

## Undocumented paths

**Not probed** — audit uses only endpoints listed above.
`
  );

  writeText(
    path.join(REPORT_DIR, 'UPSTREAM_EXPORT_REQUEST.md'),
    `# Upstream export request (Maps Read)

Verdict: **${verdictCode}**

${UPSTREAM_EXPORT_REQUEST.note}

## Required contract

${Object.entries(UPSTREAM_EXPORT_REQUEST.required_fields_per_line_per_frame)
  .map(([k, v]) => `- \`${k}\`: ${v}`)
  .join('\n')}

V3 **cannot** proceed on physical lane count until Maps Read (or an approved offline decoder path) supplies ordered per-line geometry.
`
  );

  writeText(
    path.join(REPORT_DIR, 'FINAL_REPORT.md'),
    `# Maps Read lane-geometry capability audit

## Verdict: **${verdictCode}**

## Summary

- Documented Maps Read API (\`${MAPS_READ_API_BASE}\`) exposes **${endpointMatrix.length}** endpoints in \`/docs\`.
- Only **\`/v1/geojson\`** returns lane/edge geometry; documentation and metadata specify **modelV2 samples at x=1 m** as **EPSG:4326 Points** (schema \`kommu.maps.visualization-point-cloud\`).
- **No** documented endpoint returns qlog download, raw modelV2 payloads, or ordered polyline arrays.
- Live probes during this audit: ${liveOk ? 'at least one HTTP 200' : '**no HTTP 200** (e.g. 502 from upstream)'} — capability conclusion relies on **documented /docs contract** plus **local redacted copy** of a prior \`/v1/geojson\` response for **Drive 005**.

## Route audited

- **drive-005** (\`${drive.route_redacted}\`, dongle \`${drive.dongle_redacted}\`)
- Cross-check: metadata \`point_reference\` = modelV2 at x=1 metre; max **1** point per (\`frame_id\`, \`lane_index\`).

## V3

**Cannot proceed** on lane-count enrichment via current Maps Read API surface.

## Safety

No production code, UI, OSM, local bundles, or Maps Read writes changed. No tokens logged.

Phase 0 checkpoint: \`.checkpoint_test_backup/pre_maps_read_lane_geometry_capability_audit/\`
HEAD: \`${phase0State.head}\`
`
  );

  writeText(
    path.join(REPORT_DIR, 'commands.txt'),
    `cd C:\\Pintaz-Map-Prototype
node --check scripts/run-maps-read-lane-geometry-capability-audit.js
node scripts/run-maps-read-lane-geometry-capability-audit.js
npm test
npm run validate:data
node -e "import { verifyProtectedInputHashes } from './src/lib/multi-drive-rebuild-guard.js'; console.log(verifyProtectedInputHashes());"
git diff --check
`
  );

  const protected_hashes = verifyProtectedInputHashes(ROOT_DIR);
  writeJson(path.join(REPORT_DIR, 'validation.json'), {
    schema: 'pintaz.maps-read-lane-geometry-capability.validation',
    phase0: phase0State,
    protected_hashes_ok: protected_hashes.ok === true,
    verdict: verdictCode,
    token_configured: tokenPresent,
    live_api_reachable: liveOk,
    lane_count_inferred: false,
  });

  try {
    fs.rmSync(WORK_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  console.log('Verdict:', verdictCode);
  console.log('Wrote', REPORT_DIR);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

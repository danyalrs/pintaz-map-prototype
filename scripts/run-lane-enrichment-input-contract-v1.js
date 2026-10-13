#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT_DIR } from '../src/config.js';
import { verifyProtectedInputHashes, readGitHead } from '../src/lib/multi-drive-rebuild-guard.js';
import { validateLaneEnrichmentInputContract } from '../src/lib/lane-enrichment-input-contract/index.js';

const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'lane_enrichment_input_contract_v1');

function writeText(p, t) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, t, 'utf8');
}

function writeJson(p, o) {
  writeText(p, `${JSON.stringify(o, null, 2)}\n`);
}

async function main() {
  const casesUrl = pathToFileURL(
    path.join(ROOT_DIR, 'tests', 'fixtures', 'lane-enrichment-input-contract', 'cases.js')
  ).href;
  const {
    caseA_validOneLane,
    caseB_validThreeLane,
    caseC_mapsReadPointOnly,
    caseD_missingCoordinateFrame,
    caseE_duplicateLineInFrame,
    caseF_invalidProbability,
    caseG_oneVertexLine,
    caseH_twoWay,
    toExampleGeojson,
  } = await import(casesUrl);

  const head = readGitHead(ROOT_DIR);
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  const protected_hashes = verifyProtectedInputHashes(ROOT_DIR);

  const caseFns = {
    A: caseA_validOneLane,
    B: caseB_validThreeLane,
    C: caseC_mapsReadPointOnly,
    D: caseD_missingCoordinateFrame,
    E: caseE_duplicateLineInFrame,
    F: caseF_invalidProbability,
    G: caseG_oneVertexLine,
    H: caseH_twoWay,
  };
  const caseResults = {};
  for (const [k, fn] of Object.entries(caseFns)) {
    caseResults[k] = validateLaneEnrichmentInputContract(fn()).outcome;
  }

  writeJson(path.join(REPORT_DIR, 'example_valid_bundle.geojson'), toExampleGeojson(caseA_validOneLane()));

  writeText(
    path.join(REPORT_DIR, 'CONTRACT.md'),
    `# Lane enrichment input contract V1

## Purpose

Strict gate before \`runLaneEnrichmentCore()\`. **Does not infer lane counts.**

## Top-level fields

| Field | Required |
|-------|----------|
| \`route_key\` | yes |
| \`coordinate_frame\` | yes (schema, forward_axis, lateral_axis, units) |
| \`osm_road\` | yes (\`osm_way_id\`, \`one_way: true\`, \`centreline_local_m\`) |
| \`cross_section\` | yes (anchor + tangent or forward/lateral anchor + tangent_forward) |
| \`vehicle_frames[]\` | yes |
| \`line_features[]\` | yes |

## Per vehicle frame

- \`frame_id\`, \`timestamp\`
- \`pose\`: \`forward_m\`, \`lateral_m\`, \`heading_deg\`
- \`pose_match\`: \`distance_m\`, \`heading_diff_deg\`, optional \`quality\`

## Per line feature

- \`frame_id\`, \`feature_type\` (\`lane_boundary\` | \`road_edge\`), \`line_id\`
- \`probability\` ∈ [0, 1], optional \`uncertainty\`
- \`coordinates_local_m\`: ≥2 distinct \`[forward_m, lateral_m]\` vertices
- **Not** \`lane_index\` as lane ordinal

## Compact JSON example

\`\`\`json
${JSON.stringify(
  {
    schema: 'pintaz.lane-enrichment-input.v1',
    route_key: 'drive-005',
    coordinate_frame: {
      schema: 'ego_vehicle_m',
      forward_axis: '+x_along_heading',
      lateral_axis: '+y_left',
      units: 'metres',
    },
    osm_road: { osm_way_id: '39914067', one_way: true, centreline_local_m: [[0, 0], [50, 0]] },
    cross_section: { cross_section_id: 'cs-1', anchor_forward_m: 25, anchor_lateral_m: 0, tangent_forward: [1, 0] },
    vehicle_frames: [
      {
        frame_id: 1,
        timestamp: '60000000000',
        pose: { forward_m: 25, lateral_m: 0, heading_deg: 90 },
        pose_match: { distance_m: 0.5, heading_diff_deg: 3 },
      },
    ],
    line_features: [
      {
        frame_id: 1,
        feature_type: 'road_edge',
        line_id: 're_l',
        probability: 0.9,
        coordinates_local_m: [[10, -2], [40, -2]],
      },
    ],
  },
  null,
  2
)}
\`\`\`

## Maps Read export path (future)

Maps Read would add a **new schema** (not \`kommu.maps.visualization-point-cloud\`) exporting \`line_features\` with ordered \`coordinates_local_m\` per frame, plus OSM context—or wrap the contract in \`FeatureCollection.metadata.lane_enrichment_contract\`.

**Current \`GET /v1/geojson\`** returns **Point** \`lane_point\` / \`edge_point\` at x=1 m → validator returns \`unsupported_point_only\`.

## Feeding V3 core

\`\`\`js
import { validateLaneEnrichmentInputContract, toAlgorithmCoreBundle } from './lane-enrichment-input-contract/index.js';
import { runLaneEnrichmentCore } from './lane-enrichment-algorithm-core/index.js';

const v = validateLaneEnrichmentInputContract(exportBundle);
if (v.outcome !== 'valid') throw new Error(v.outcome);
const { bundle } = toAlgorithmCoreBundle(exportBundle);
const result = runLaneEnrichmentCore(bundle); // review candidate only
\`\`\`

## Synthetic case outcomes

\`\`\`json
${JSON.stringify(caseResults, null, 2)}
\`\`\`
`
  );

  writeText(
    path.join(REPORT_DIR, 'FINAL_REPORT.md'),
    `# Lane enrichment input contract validator V1

Validates future Maps Read **polyline** exports before \`lane-enrichment-algorithm-core\`.

- **No** integration with current point-only GeoJSON.
- **No** real OSM lane-count candidates.

HEAD: \`${head}\` (\`${branch}\`)

See \`CONTRACT.md\` and \`example_valid_bundle.geojson\`.
`
  );

  writeJson(path.join(REPORT_DIR, 'validation.json'), {
    protected_hashes_ok: protected_hashes.ok === true,
    head,
    branch,
    case_results: caseResults,
    lane_count_inferred: false,
    osm_updated: false,
  });

  writeText(
    path.join(REPORT_DIR, 'commands.txt'),
    `cd C:\\Pintaz-Map-Prototype
node scripts/run-lane-enrichment-input-contract-v1.js
npm test
`
  );

  console.log('Wrote', REPORT_DIR);
  console.log('Cases', caseResults);
}

main();

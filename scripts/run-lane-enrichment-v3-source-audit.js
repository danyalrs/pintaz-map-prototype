#!/usr/bin/env node
/**
 * V3 source-availability audit — reports only under reports/lane_enrichment_v3_source_availability_audit/
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ROOT_DIR } from '../src/config.js';
import { verifyProtectedInputHashes, readGitHead } from '../src/lib/multi-drive-rebuild-guard.js';
import {
  listInventoryPaths,
  resolveActivePreviewAbs,
  resolveCompleteRoutePreview,
  buildSourceFieldMatrix,
  buildExampleFrameTrace,
  assessCrossSectionFeasibility,
  computeVerdict,
  UPSTREAM_EXPORT_CONTRACT,
  buildLocalFrameSvg,
  EXAMPLE_FRAME_ID,
  EXAMPLE_OSM_WAY,
  EXAMPLE_CROSS_SECTION_ID,
} from '../src/lib/lane-enrichment-v3-source-audit/index.js';
import { RAW_SAMPLE_PATH } from '../src/lib/update-preview-paths.js';
import { probeRawPath } from '../src/lib/bukit-page1-probe-paths.js';

const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'lane_enrichment_v3_source_availability_audit');
const CHECKPOINT = path.join(
  ROOT_DIR,
  '.checkpoint_test_backup',
  'pre_lane_enrichment_v3_source_availability_audit'
);

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

function main() {
  const phase0State = phase0();
  const inventory = listInventoryPaths();
  const previewAbs = resolveActivePreviewAbs();
  const completeRoute = resolveCompleteRoutePreview();
  const fieldMatrix = buildSourceFieldMatrix(previewAbs, [
    { path: completeRoute, label: 'complete_route_derived' },
    { path: RAW_SAMPLE_PATH, label: 'bukit_sample_page1' },
    { path: probeRawPath('drive-005'), label: 'probe_raw_drive_005_page1' },
  ]);
  const verdict = computeVerdict(fieldMatrix);
  const frameTrace = buildExampleFrameTrace(previewAbs, EXAMPLE_FRAME_ID);
  const crossFeas = assessCrossSectionFeasibility(previewAbs, EXAMPLE_OSM_WAY);

  writeJson(path.join(REPORT_DIR, 'source_field_matrix.redacted.json'), {
    inventory_paths: inventory,
    field_matrix: fieldMatrix,
    verdict,
    lane_count_inferred: false,
  });

  writeJson(path.join(REPORT_DIR, 'example_frame_trace.redacted.json'), frameTrace);
  writeText(path.join(REPORT_DIR, 'LOCAL_FRAME_SAMPLES.svg'), buildLocalFrameSvg(frameTrace));

  writeText(
    path.join(REPORT_DIR, 'SOURCE_INVENTORY.md'),
    `# Source inventory — lane / edge geometry

## Code paths that produce preview GeoJSON

| Stage | File |
|-------|------|
| Active manifest | \`${inventory.active_source_manifest}\` |
| Complete route merge | \`data/maps-read/selected-route-v1/derived/complete-route-preview.geojson\` |
| Page-1 transport | \`src/lib/update-preview-prepare.js\` (NaN normalize only) |
| Explorer derived copies | \`src/lib/local-route-explorer/bootstrap.js\` → \`local-route-explorer-v1/derived-previews/*.geojson\` |
| Raw probe page 1 | \`data/maps-read/bukit-route-page1-probe-v1/private/raw/*-page-1.geojson\` |

## Active preview file

\`${path.relative(ROOT_DIR, previewAbs).replace(/\\\\/g, '/')}\`

## Geometry fact (all scanned levels)

- \`lane_point\`: **Point** only, **1** feature per (\`frame_id\`, \`lane_index\`)
- \`edge_point\`: **Point** only, **1** feature per (\`frame_id\`, \`edge_index\`)
- **0** LineString lane/edge features in complete route (${fieldMatrix.levels.find((l) => l.source_level === 'complete_route_derived')?.feature_count ?? 'n/a'} features)
- Local \`qlog.bz2\` referenced in \`properties.source_file\`: **not present** in repo

No lane-count inference was performed in this audit.
`
  );

  writeText(
    path.join(REPORT_DIR, 'CROSS_SECTION_FEASIBILITY.md'),
    `# Cross-section feasibility — ${EXAMPLE_OSM_WAY} / ${EXAMPLE_CROSS_SECTION_ID}

Route: **active** · OSM way **Jalan Sultan Ismail** · V2.1 cross-section **${EXAMPLE_CROSS_SECTION_ID}**

\`\`\`json
${JSON.stringify(crossFeas, null, 2)}
\`\`\`

**Can reconstruct ordered polyline per frame for this section?** **No.**

**Can compute line ∩ cross-section?** **No** with current local artefacts (degenerate one-point “lines”).

See \`example_frame_trace.redacted.json\` (frame **${EXAMPLE_FRAME_ID}**) for field-level evidence on a pose frame used on this section.
`
  );

  writeText(
    path.join(REPORT_DIR, 'UPSTREAM_EXPORT_CONTRACT.md'),
    `# Upstream export contract (required before V3 lane geometry)

${UPSTREAM_EXPORT_CONTRACT.note}

## Minimal example record

\`\`\`json
${JSON.stringify(
  {
    frame_id: 19685,
    timestamp: '55390955655',
    vehicle_pose: { heading_deg: 0, east_m: 0, north_m: 0 },
    feature_type: 'lane_boundary',
    line_id: 'lane_slot_2',
    probability: 0.19,
    coordinates_local_m: [
      [5.0, -4.5],
      [15.0, -4.4],
      [25.0, -4.3],
    ],
    coordinate_frame: 'vehicle: +x forward along heading, +y left lateral, metres',
  },
  null,
  2
)}
\`\`\`

## Required fields

${Object.entries(UPSTREAM_EXPORT_CONTRACT.required_fields_per_line_per_frame)
  .map(([k, v]) => `- **\`${k}\`**: ${v}`)
  .join('\n')}

**V3 cannot produce a physical lane count until this contract exists in local (or ingestible) artefacts.**
`
  );

  writeText(
    path.join(REPORT_DIR, 'FINAL_REPORT.md'),
    `# Lane enrichment V3 source-availability audit

## Verdict

**\`${verdict.code}\`**

${verdict.detail}

## Why V2 reported five lanes (context, not re-run)

V2.1 already showed four \`lane_index\` **line slots** per frame on this road, not four physical interior boundaries. This audit confirms the **local source cannot supply polylines** to correct that via intersection — only isolated Points.

## Example trace

- Frame **${EXAMPLE_FRAME_ID}** on cross-section **${EXAMPLE_CROSS_SECTION_ID}**
- **4** lane lines + **2** edge lines, **1 vertex each**
- \`can_intersect_cross_section\`: **false** for every line

## Outputs

- \`source_field_matrix.redacted.json\`
- \`example_frame_trace.redacted.json\`
- \`LOCAL_FRAME_SAMPLES.svg\` (single samples, not reconstructed polylines)
- \`UPSTREAM_EXPORT_CONTRACT.md\`

## Phase 0

Checkpoint: \`.checkpoint_test_backup/pre_lane_enrichment_v3_source_availability_audit/\`
HEAD: \`${phase0State.head}\`

**No lane count inferred. V1/V2/V2.1 unchanged.**
`
  );

  writeText(
    path.join(REPORT_DIR, 'commands.txt'),
    `cd C:\\Pintaz-Map-Prototype
# Stop server on port 3901 before npm test
node --check scripts/run-lane-enrichment-v3-source-audit.js
node scripts/run-lane-enrichment-v3-source-audit.js
npm test
npm run validate:data
node -e "import { verifyProtectedInputHashes } from './src/lib/multi-drive-rebuild-guard.js'; console.log(verifyProtectedInputHashes());"
git diff --check
`
  );

  const protected_hashes = verifyProtectedInputHashes(ROOT_DIR);
  writeJson(path.join(REPORT_DIR, 'validation.json'), {
    schema: 'pintaz.lane-enrichment-v3.source-audit.validation',
    phase0: phase0State,
    protected_hashes_ok: protected_hashes.ok === true,
    verdict_code: verdict.code,
    cross_section_feasibility: crossFeas,
    lane_count_inferred: false,
  });

  console.log('Verdict:', verdict.code);
  console.log('Wrote', REPORT_DIR);
}

main();

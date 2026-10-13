#!/usr/bin/env node
/**
 * Untracked offline runner — writes only under reports/lane_enrichment_candidate_builder_v1/
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT_DIR } from '../src/config.js';
import { verifyProtectedInputHashes, readGitHead } from '../src/lib/multi-drive-rebuild-guard.js';
import { OBSERVATION_ROUTES } from '../src/lib/local-route-explorer/config.js';
import {
  buildAllRoutes,
  summarizeRejections,
  exportSourceSemanticsRedacted,
  SOURCE_SEMANTICS_AUDIT,
} from '../src/lib/lane-enrichment-candidates/index.js';

const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'lane_enrichment_candidate_builder_v1');
const CHECKPOINT = path.join(ROOT_DIR, '.checkpoint_test_backup', 'pre_lane_enrichment_candidate_builder_v1');

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
  const state = { head, branch, porcelain, protected_hashes };
  fs.mkdirSync(CHECKPOINT, { recursive: true });
  writeJson(path.join(CHECKPOINT, 'protected-state.json'), state);
  return state;
}

function main() {
  const phase0State = phase0();
  const routeKeys = OBSERVATION_ROUTES.map((r) => r.route_key);
  const rows = buildAllRoutes(routeKeys, { includeOsmBaselineWays: ['252085334'] });
  const rejection_summary = summarizeRejections(rows);

  writeJson(path.join(REPORT_DIR, 'source_semantics.redacted.json'), exportSourceSemanticsRedacted());
  writeJson(path.join(REPORT_DIR, 'candidate_rows.redacted.json'), {
    schema: 'pintaz.lane-enrichment-candidate-rows.v1',
    row_count: rows.length,
    rows,
  });
  writeJson(path.join(REPORT_DIR, 'rejection_summary.json'), rejection_summary);

  const kamuning = rows.find((r) => r.osm_way_id === '39914067' && r.route_key === 'drive-005');
  const sultan = rows.find((r) => r.osm_way_id === '252085334' && r.route_key === 'active');
  const barat = rows.find((r) => r.osm_way_id === '772518907' && r.route_key === 'drive-008');

  writeText(
    path.join(REPORT_DIR, 'FINAL_REPORT.md'),
    `# Lane enrichment candidate builder V1 — final report

## Phase 0

- Branch: \`${phase0State.branch}\`
- HEAD: \`${phase0State.head}\`
- Checkpoint: \`.checkpoint_test_backup/pre_lane_enrichment_candidate_builder_v1/\`

## Source semantics (headline)

${SOURCE_SEMANTICS_AUDIT.green_dot_statement}

Physical lane-count inference from current preview GeoJSON: **${SOURCE_SEMANTICS_AUDIT.physical_lane_count_supported ? 'yes' : 'no'}**.

## Required test cases

| Case | Result |
|------|--------|
| Drive 005 / Jalan Kamuning / 39914067 | \`${kamuning?.decision}\` — selected_lane_count \`${kamuning?.selected_lane_count}\` |
| Jalan Sultan Ismail / 252085334 (OSM lanes=3) | \`${sultan?.decision}\` |
| Poor coverage example (772518907 / drive-008) | \`${barat?.decision}\` |

## Outputs

- \`candidate_rows.redacted.json\` — ${rows.length} rows (per route × missing-lane ways on matcher)
- \`rejection_summary.json\`
- \`SOURCE_SEMANTICS_AUDIT.md\`, \`ALGORITHM_DESIGN.md\`, \`test_cases.md\`

No UI, OSM inputs, comparison gates, or automatic OSM writes were changed.
`
  );

  writeText(
    path.join(REPORT_DIR, 'commands.txt'),
    `cd C:\\Pintaz-Map-Prototype
# Stop server on 3901 before npm test
node --check scripts/run-lane-enrichment-candidate-builder-v1.js
node scripts/run-lane-enrichment-candidate-builder-v1.js
npm test
npm run validate:data
node -e "import { verifyProtectedInputHashes } from './src/lib/multi-drive-rebuild-guard.js'; console.log(verifyProtectedInputHashes());"
git diff --check
`
  );

  writeJson(path.join(REPORT_DIR, 'validation.json'), {
    schema: 'pintaz.lane-enrichment-candidate-builder.validation.v1',
    phase0: phase0State,
    protected_hashes_ok: phase0State.protected_hashes?.ok === true,
    note: 'Run npm test after stopping local server; update this file manually or re-run validation pass.',
  });

  console.log('Wrote', REPORT_DIR);
  console.log('Rows:', rows.length);
}

main();

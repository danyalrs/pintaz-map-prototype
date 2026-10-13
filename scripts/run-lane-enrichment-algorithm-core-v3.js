#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT_DIR } from '../src/config.js';
import { verifyProtectedInputHashes, readGitHead } from '../src/lib/multi-drive-rebuild-guard.js';
import { runLaneEnrichmentCore, DECISION_SCORE_DISCLAIMER } from '../src/lib/lane-enrichment-algorithm-core/index.js';

const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'lane_enrichment_algorithm_core_v3');

function writeText(p, t) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, t, 'utf8');
}

function writeJson(p, o) {
  writeText(p, `${JSON.stringify(o, null, 2)}\n`);
}

function summarize(r) {
  return {
    decision: r.decision,
    selected_lane_count: r.selected_lane_count,
    decision_score: r.decision_score,
    confidence_band: r.confidence_band,
    support_type: r.support_type,
    human_review_required: r.human_review_required,
    never_auto_apply: r.never_auto_apply,
  };
}

async function main() {
  const casesUrl = pathToFileURL(
    path.join(ROOT_DIR, 'tests', 'fixtures', 'lane-enrichment-algorithm-core', 'cases.js')
  ).href;
  const { ALL_CASES } = await import(casesUrl);

  const head = readGitHead(ROOT_DIR);
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  const protected_hashes = verifyProtectedInputHashes(ROOT_DIR);

  const results = {};
  for (const [key, fn] of Object.entries(ALL_CASES)) {
    results[key] = summarize(runLaneEnrichmentCore(fn()));
  }

  writeJson(path.join(REPORT_DIR, 'synthetic_case_results.json'), {
    schema: 'pintaz.lane-enrichment-algorithm-core.v3.synthetic',
    disclaimer:
      'This validates the future geometry algorithm against controlled synthetic data. It does not validate or infer lane counts from current Maps Read point-only GeoJSON.',
    decision_score_disclaimer: DECISION_SCORE_DISCLAIMER,
    results,
  });

  writeText(
    path.join(REPORT_DIR, 'FINAL_REPORT.md'),
    `# Lane enrichment algorithm core V3 — synthetic validation

**This validates the future geometry algorithm against controlled synthetic data. It does not validate or infer lane counts from current Maps Read point-only GeoJSON.**

No production integration. No real OSM enrichment candidates.

HEAD: \`${head}\` (\`${branch}\`)
`
  );

  writeJson(path.join(REPORT_DIR, 'validation.json'), {
    protected_hashes_ok: protected_hashes.ok === true,
    head,
    branch,
    real_lane_count_inferred: false,
    maps_read_integration: false,
  });

  writeText(
    path.join(REPORT_DIR, 'commands.txt'),
    `cd C:\\Pintaz-Map-Prototype
node scripts/run-lane-enrichment-algorithm-core-v3.js
npm test
`
  );

  console.log('Wrote', REPORT_DIR);
}

main();

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ROOT_DIR } from '../src/config.js';
import { buildBukitMultiDriveMismatchV1 } from '../src/lib/multi-drive-build.js';
import { checkpointBackupDir, MULTI_DRIVE_KEYS } from '../src/lib/multi-drive-mismatch-config.js';
import { assertMultiDriveRebuildAllowed } from '../src/lib/multi-drive-rebuild-guard.js';
import { aggregateSummaryRedactedPath, multiDriveBaseDir } from '../src/lib/multi-drive-mismatch-paths.js';
import { DEFAULT_PARAMS } from '../src/lib/mismatch-classify.js';

const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'bukit_multi_drive_mismatch_v1');

function run(cmd) {
  return execSync(cmd, { cwd: ROOT_DIR, encoding: 'utf8' });
}

function writeReport(name, content) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, name), content, 'utf8');
}

function phase0() {
  try {
    const guard = assertMultiDriveRebuildAllowed();
    const backup = checkpointBackupDir();
    fs.mkdirSync(backup, { recursive: true });
    const snapshot = {
      head: guard.head,
      baseline: guard.baseline,
      guard: 'merge-base-ancestor+clean-tracked+protected-hashes',
      port: 3901,
      recorded_at: new Date().toISOString(),
      test_count_note: 'run npm test for count',
    };
    fs.writeFileSync(path.join(backup, 'protected-state.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
    return snapshot;
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

function writeReports(result) {
  writeReport(
    'FINAL_REPORT.md',
    `# Bukit multi-drive OSM mismatch V1\n\nBuild completed at ${new Date().toISOString()}.\n\nSee aggregate-summary and per-drive summaries in gitignored data.\n`
  );
  writeReport(
    'AGREEMENT_RULES.md',
    `# Agreement rules\n\nThresholds frozen at mismatch V1.1 DEFAULT_PARAMS: ${JSON.stringify(DEFAULT_PARAMS)}\n`
  );
  writeReport('INPUT_DRIVES.md', `# Inputs\n\n${MULTI_DRIVE_KEYS.map((k) => `- ${k}`).join('\n')}\n`);
  writeReport(
    'commands.txt',
    'node scripts/build-bukit-multi-drive-mismatch-v1.js\nnode scripts/build-multi-drive-pilot-scope-diagnosis-v1.js\nnpm test\nnpm run validate:data\n'
  );
  writeReport(
    'PILOT_BOUNDARY_CONVENTION.md',
    `# Pilot boundary convention\n\nShared helper: \`pointInsideBukitPilot\` in \`src/lib/bukit-pilot-bounds.js\`.\n\nInclusive on west, south, east, and north edges (lon/lat equal to min/max bbox values are inside). Points immediately outside use strict inequality.\n\nUsed for update-preview inside/outside counts, multi-drive matcher input, mismatch outside_coverage (exact pilot rectangle), and UI pilot pose totals.\n`
  );
  const aggPath = aggregateSummaryRedactedPath();
  if (fs.existsSync(aggPath)) {
    fs.copyFileSync(aggPath, path.join(REPORT_DIR, 'aggregate_metrics.json'));
  }
  writeReport(
    'manifest.json',
    `${JSON.stringify({ schema: 'pintaz.reports.bukit-multi-drive-v1', drives: MULTI_DRIVE_KEYS }, null, 2)}\n`
  );
}

function main() {
  phase0();
  console.log('Phase 0 OK');
  const result = buildBukitMultiDriveMismatchV1({ baseDir: multiDriveBaseDir() });
  writeReports(result);
  console.log(JSON.stringify({ ok: true, candidates: result.candidates, stateCounts: result.stateCounts }, null, 2));
}

main();

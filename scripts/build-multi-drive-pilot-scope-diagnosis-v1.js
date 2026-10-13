#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ROOT_DIR } from '../src/config.js';
import { assertMultiDriveRebuildAllowed } from '../src/lib/multi-drive-rebuild-guard.js';
import { buildBukitMultiDriveMismatchV1 } from '../src/lib/multi-drive-build.js';
import { multiDriveBaseDir, aggregateSummaryRedactedPath } from '../src/lib/multi-drive-mismatch-paths.js';
import { runMultiDrivePilotDiagnosis } from '../src/lib/multi-drive-pilot-diagnosis.js';
import { redactedDongleAuditForReports, buildActualDongleGroups } from '../src/lib/multi-drive-dongle-audit.js';

const REPORT = path.join(ROOT_DIR, 'reports', 'bukit_multi_drive_mismatch_v1');
const CHECKPOINT = path.join(ROOT_DIR, '.checkpoint_test_backup', 'pre_multi_drive_pilot_scope_diagnosis_v1');

function phase0() {
  try {
    const guard = assertMultiDriveRebuildAllowed();
    fs.mkdirSync(CHECKPOINT, { recursive: true });
    fs.writeFileSync(
      path.join(CHECKPOINT, 'protected-state.json'),
      `${JSON.stringify({ head: guard.head, baseline: guard.baseline, recorded_at: new Date().toISOString() }, null, 2)}\n`
    );
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

function writeReports(diagnosis, agg) {
  fs.mkdirSync(REPORT, { recursive: true });
  const md = (name, body) => fs.writeFileSync(path.join(REPORT, name), body, 'utf8');
  md(
    'PILOT_SCOPE_DIAGNOSIS.md',
    `# Pilot scope diagnosis\n\nMatcher scope: **inside pilot only** (exact route-selection bbox, inclusive edges).\n\nBefore fix, comparison sent **all route vehicle poses** to the matcher.\n\nAfter fix, outside-pilot poses are excluded with reason \`outside_pilot\` and never contribute to sections.\n`
  );
  md(
    'BEFORE_AFTER_SCOPE_FIX.md',
    `# Before / after scope fix\n\n| Metric | Before (documented) | After |\n|--------|---------------------|-------|\n| Matcher input | Complete route poses | Inside-pilot poses only |\n| Mismatch coverage | Active-route hull (multi-drive bug) | Per-drive exact pilot bbox |\n\nSee \`pilot_scope_metrics.redacted.json\` for per-drive counts.\n`
  );
  md('DONGLE_INDEPENDENCE_AUDIT.md', `# Dongle independence\n\n\`\`\`json\n${JSON.stringify(redactedDongleAuditForReports(buildActualDongleGroups()), null, 2)}\n\`\`\`\n`);
  md(
    'MATCHING_REJECTION_FUNNEL.md',
    `# Matching rejection funnel\n\nSee rejection_funnel.redacted.json.\n`
  );
  md('SECTION_SUPPORT_FUNNEL.md', `# Section support funnel\n\nSee support-funnel.redacted.json.\n`);
  md('GROUPING_AUDIT.md', `# Grouping audit\n\nSee grouping-audit.redacted.json.\n`);
  md(
    'PILOT_BOUNDARY_CONVENTION.md',
    `# Pilot boundary convention\n\nShared helper: \`pointInsideBukitPilot\` in \`src/lib/bukit-pilot-bounds.js\` (inclusive west/south/east/north edges).\n`
  );
  fs.writeFileSync(
    path.join(REPORT, 'commands.txt'),
    'node scripts/build-multi-drive-pilot-scope-diagnosis-v1.js\nnode scripts/build-bukit-multi-drive-mismatch-v1.js\nnpm test\nnpm run validate:data\n'
  );
  fs.copyFileSync(
    path.join(multiDriveBaseDir(), 'redacted', 'pilot-scope-metrics.redacted.json'),
    path.join(REPORT, 'pilot_scope_metrics.redacted.json')
  );
  fs.copyFileSync(
    path.join(multiDriveBaseDir(), 'redacted', 'rejection-funnel.redacted.json'),
    path.join(REPORT, 'rejection_funnel.redacted.json')
  );
  fs.copyFileSync(
    path.join(multiDriveBaseDir(), 'redacted', 'support-funnel.redacted.json'),
    path.join(REPORT, 'support_funnel.redacted.json')
  );
  fs.copyFileSync(
    path.join(multiDriveBaseDir(), 'redacted', 'grouping-audit.redacted.json'),
    path.join(REPORT, 'grouping_audit.redacted.json')
  );
  if (fs.existsSync(aggregateSummaryRedactedPath())) {
    fs.copyFileSync(aggregateSummaryRedactedPath(), path.join(REPORT, 'aggregate_metrics.json'));
  }
  fs.writeFileSync(
    path.join(REPORT, 'FINAL_REPORT.md'),
    `# Multi-drive pilot scope & eligibility diagnosis V1\n\nSupport-eligible sections: **${diagnosis.combined.support_eligible_centreline + diagnosis.combined.support_eligible_lane_edge}**. Multi-drive candidates: **${agg?.multi_drive_candidates ?? 0}**.\n`
  );
}

phase0();
const result = buildBukitMultiDriveMismatchV1();
const diagnosis = runMultiDrivePilotDiagnosis(multiDriveBaseDir());
const agg = JSON.parse(fs.readFileSync(aggregateSummaryRedactedPath(), 'utf8'));
writeReports(diagnosis, agg);
console.log(JSON.stringify({ ok: true, result, combined: diagnosis.combined }, null, 2));

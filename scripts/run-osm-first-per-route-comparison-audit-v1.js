#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ROOT_DIR } from '../src/config.js';
import { verifyProtectedInputHashes, readGitHead } from '../src/lib/multi-drive-rebuild-guard.js';
import { runOsmFirstPerRouteComparisonAudit } from '../src/lib/osm-first-per-route-comparison-audit/run-audit.js';
import { bootstrapLocalRouteExplorer } from '../src/lib/local-route-explorer/bootstrap.js';

const EXPECTED_HEAD = 'de9b39e94a12a2afe5e206ce4fb2aca5e773cfa1';
const REPORT_DIR = path.join(ROOT_DIR, 'reports', 'osm_first_per_route_comparison_audit_v1');
const CHECKPOINT = path.join(ROOT_DIR, '.checkpoint_test_backup', 'pre_osm_first_per_route_comparison_audit_v1');
const FOCUS_OSM_ID = '779663464';

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
  const hashes = verifyProtectedInputHashes(ROOT_DIR);
  const porcelain = execSync('git status --porcelain', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  const state = { head, branch, expected_head: EXPECTED_HEAD, protected_hashes: hashes, porcelain };
  writeJson(path.join(CHECKPOINT, 'protected-state.json'), state);
  return state;
}

function buildSummaryMd(audit) {
  const lines = [
    '# OSM-first per-route comparison audit V1',
    '',
    'Read-only audit against the existing OSM lane baseline and per-route comparison outputs. **No multi-drive aggregation** and **no production map update** occurred.',
    '',
    '**Important:** Observation dots or lane/edge points alone do **not** prove an OSM mismatch; only gated comparison sections (and existing proposal rules) inform `mismatch_candidate`.',
    '',
    `Eligible OSM ways (explicit usable lane count): **${audit.eligible_osm_way_count}**`,
    '',
  ];
  for (const r of audit.routes) {
    lines.push(`## ${r.route_key}${r.diagnostic_only ? ' (diagnostic only)' : ''}`);
    lines.push('');
    lines.push(`- Comparison sections loaded: ${r.comparison_sections_available ? 'yes' : 'no'}`);
    lines.push(`- Matched poses: ${r.matched_pose_count}; rejected poses: ${r.rejected_pose_count}`);
    lines.push(`- Totals: alignment_consistent **${r.totals.alignment_consistent}**, insufficient_evidence **${r.totals.insufficient_evidence}**, not_evaluated **${r.totals.not_evaluated}**, mismatch_candidate **${r.totals.mismatch_candidate}**`);
    lines.push('');
  }
  lines.push('## Genuine mismatch candidates');
  lines.push('');
  if (!audit.mismatch_candidates.length) {
    lines.push('None under existing production proposal/display gates.');
  } else {
    for (const c of audit.mismatch_candidates) {
      lines.push(`- ${c.route_key} — OSM ${c.osm_id} (${c.road_name || 'unnamed'}), lanes=${c.osm_lane_count}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function buildTunRazakSection(audit) {
  const drive008 = audit.routes.find((r) => r.route_key === 'drive-008');
  const row = drive008?.ways?.find((w) => w.osm_id === FOCUS_OSM_ID);
  const active = audit.routes.find((r) => r.route_key === 'active')?.ways?.find((w) => w.osm_id === FOCUS_OSM_ID);
  return `# Jalan Tun Razak (OSM ${FOCUS_OSM_ID})

Focus: **Drive 008** diagnostic observation route (coverage-expansion candidate).

| Field | Drive 008 | Active (reference) |
|-------|-----------|-------------------|
| Road name | ${row?.road_name ?? 'Jalan Tun Razak'} | ${active?.road_name ?? '—'} |
| OSM lane count | ${row?.osm_lane_count ?? 4} | ${active?.osm_lane_count ?? '—'} |
| Result | **${row?.result ?? 'not_evaluated'}** | ${active?.result ?? '—'} |
| First failed gate | ${row?.first_failed_gate ?? '—'} | ${active?.first_failed_gate ?? '—'} |
| Vehicle frames (sections) | ${row?.observation_counts?.vehicle_frames ?? 0} | ${active?.observation_counts?.vehicle_frames ?? 0} |
| Lane / edge / GPS obs | ${row?.observation_counts?.lane_observations ?? 0} / ${row?.observation_counts?.edge_observations ?? 0} / ${row?.observation_counts?.gps_observations ?? 0} | ${active?.observation_counts?.lane_observations ?? 0} / ${active?.observation_counts?.edge_observations ?? 0} / ${active?.observation_counts?.gps_observations ?? 0} |
| Comparison sections | ${row?.section_count ?? 0} | ${active?.section_count ?? 0} |
| Proposal eligible (production rules) | ${row?.proposal_eligible_any ? 'yes' : 'no'} | ${active?.proposal_eligible_any ? 'yes' : 'no'} |

Observation points on this way are **not** treated as proof of mismatch without passing existing spatial, continuity, frame-count, and support gates.

Drive 008 remains **diagnostic only**; production active source unchanged.
`;
}

function main() {
  const phase0State = phase0();
  bootstrapLocalRouteExplorer();
  const audit = runOsmFirstPerRouteComparisonAudit();

  const missing = audit.routes.filter((r) => !r.comparison_sections_available);
  if (missing.length) {
    audit.limitations.push(
      `Routes without comparison build: ${missing.map((r) => r.route_key).join(', ')} — run build-local-route-explorer-bundles-v1.js`
    );
  }

  writeJson(path.join(REPORT_DIR, 'audit.redacted.json'), audit);
  writeText(path.join(REPORT_DIR, 'SUMMARY.md'), buildSummaryMd(audit));
  writeText(path.join(REPORT_DIR, 'JALAN_TUN_RAZAK_779663464.md'), buildTunRazakSection(audit));
  writeJson(path.join(REPORT_DIR, 'mismatch_candidates.redacted.json'), {
    count: audit.mismatch_candidates.length,
    candidates: audit.mismatch_candidates,
  });
  writeText(
    path.join(REPORT_DIR, 'LIMITATIONS.md'),
    `# Limitations\n\n${audit.limitations.map((l) => `- ${l}`).join('\n') || '- Diagnostic routes use the same comparison builder as production; thresholds and classifySection rules were not modified.'}\n\n- Mismatch pipeline / multi-drive aggregation not used.\n`
  );
  writeText(
    path.join(REPORT_DIR, 'commands.txt'),
    `cd C:\\Pintaz-Map-Prototype
node scripts/build-local-route-explorer-bundles-v1.js
node scripts/run-osm-first-per-route-comparison-audit-v1.js
node --check scripts/run-osm-first-per-route-comparison-audit-v1.js
npm test
npm run validate:data
git diff --check
`
  );
  writeJson(path.join(REPORT_DIR, 'manifest.json'), {
    schema: 'pintaz.report.manifest.v1',
    report: 'osm_first_per_route_comparison_audit_v1',
    head: phase0State.head,
    files: [
      'SUMMARY.md',
      'JALAN_TUN_RAZAK_779663464.md',
      'LIMITATIONS.md',
      'audit.redacted.json',
      'mismatch_candidates.redacted.json',
      'validation.json',
      'commands.txt',
      'manifest.json',
    ],
  });

  const validation = {
    phase0: phase0State,
    protected_hashes_ok: phase0State.protected_hashes?.ok === true,
    audit_route_count: audit.routes.length,
    mismatch_candidate_count: audit.mismatch_candidates.length,
  };
  writeJson(path.join(REPORT_DIR, 'validation.json'), validation);
  console.log('Wrote', REPORT_DIR);
  console.log('Mismatch candidates:', audit.mismatch_candidates.length);
}

main();

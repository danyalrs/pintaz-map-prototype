import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { ROOT_DIR } from '../../config.js';
import { verifyProtectedInputHashes, readGitHead } from '../multi-drive-rebuild-guard.js';
import { aggregateSummaryRedactedPath } from '../multi-drive-mismatch-paths.js';

export const EXPECTED_HEAD = '4f8f8c29e3848bb03a4669cccd33b0039aa678c8';

function fetchJson(url) {
  try {
    return JSON.parse(
      execSync(`node -e "fetch('${url}').then(r=>r.json()).then(j=>console.log(JSON.stringify(j)))"`, {
        encoding: 'utf8',
        timeout: 15000,
      })
    );
  } catch {
    return null;
  }
}

export function verifyPhase0({ rootDir = ROOT_DIR, requireServer = true } = {}) {
  const errors = [];
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
  const head = readGitHead(rootDir);
  if (branch !== 'main') errors.push(`branch:${branch}`);
  if (head !== EXPECTED_HEAD) errors.push(`head:${head}`);

  const porcelain = execSync('git status --porcelain', { cwd: rootDir, encoding: 'utf8' }).trim();
  const lines = porcelain ? porcelain.split('\n') : [];
  const allowed = (p) =>
    p.startsWith('src/lib/same-osm-way-cross-drive-feasibility/') ||
    p === 'scripts/run-same-osm-way-cross-drive-accumulation-feasibility-v1.js' ||
    p === 'tests/same-osm-way-cross-drive-accumulation-feasibility.test.js' ||
    p.startsWith('reports/same_osm_way_cross_drive_accumulation_v1/');
  for (const line of lines) {
    const mod = line.match(/^ M (.+)$/);
    const unt = line.match(/^\?\? (.+)$/);
    if (mod) errors.push(`modified_tracked:${mod[1]}`);
    if (unt && !allowed(unt[1].replace(/\\/g, '/'))) errors.push(`untracked:${unt[1]}`);
  }

  const hashCheck = verifyProtectedInputHashes(rootDir);
  if (!hashCheck.ok) errors.push('protected_hashes');

  const aggPath = aggregateSummaryRedactedPath();
  let baseline = null;
  if (fs.existsSync(aggPath)) {
    baseline = JSON.parse(fs.readFileSync(aggPath, 'utf8'));
    const s = baseline.support_eligible_totals || {};
    if (s.support_eligible_centreline !== 1) errors.push('support_centreline');
    if (s.support_eligible_lane_edge !== 0) errors.push('support_lane_edge');
    if (baseline.multi_drive_candidates !== 0) errors.push('candidates');
    if (baseline.single_drive_consistent_sections !== 1) errors.push('single_consistent');
    if (baseline.consistent_across_drives !== 0) errors.push('cross_consistent');
    if (baseline.aggregate_state_counts?.insufficient_combined_evidence !== 187) {
      errors.push('insufficient_evidence');
    }
    if (baseline.distinct_dongle_groups !== 4) errors.push('dongle_groups');
  } else errors.push('missing_aggregate');

  const server = {};
  if (requireServer) {
    try {
      server.port_3901_listener = execSync('netstat -ano | findstr :3901', { encoding: 'utf8' }).includes('LISTENING');
    } catch {
      server.port_3901_listener = false;
    }
    if (!server.port_3901_listener) errors.push('no_listener');
    else {
      server.health = fetchJson('http://127.0.0.1:3901/health');
      server.active_route_metrics = fetchJson(
        'http://127.0.0.1:3901/api/local-route-explorer/v1/routes/active/metrics'
      );
      server.mismatch_summary = fetchJson(
        'http://127.0.0.1:3901/api/multi-drive-mismatch/v1/bukit-bintang-imbi/summary'
      );
      const metrics = server.active_route_metrics?.metrics || server.active_route_metrics;
      if (metrics?.route_status !== 'complete') errors.push('route_status');
      if (metrics?.feature_total !== 8706) errors.push('features');
    }
  }

  return { ok: errors.length === 0, errors, head, branch, protected_hashes: hashCheck, baseline_summary: baseline, server };
}

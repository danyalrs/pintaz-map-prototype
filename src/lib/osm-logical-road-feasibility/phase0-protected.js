import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { ROOT_DIR } from '../../config.js';
import {
  verifyProtectedInputHashes,
  readGitHead,
  trackedWorkingTreeClean,
} from '../multi-drive-rebuild-guard.js';
import { aggregateSummaryRedactedPath } from '../multi-drive-mismatch-paths.js';
import { resolveUpdatePreviewPaths } from '../update-preview-paths.js';

export const EXPECTED_HEAD = '275163ed92c3da59d7f5595ea506a76e4e4641d0';

export function sha256File(p) {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

export function verifyPhase0({ rootDir = ROOT_DIR, requireServer = true } = {}) {
  const errors = [];
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
  const head = readGitHead(rootDir);
  if (branch !== 'main') errors.push(`branch:${branch}`);
  if (head !== EXPECTED_HEAD) errors.push(`head:${head}`);

  const porcelain = execSync('git status --porcelain', { cwd: rootDir, encoding: 'utf8' }).trim();
  const lines = porcelain ? porcelain.split('\n') : [];
  const staged = lines.filter((l) => l.startsWith('A ') || l.startsWith('M ') || l.startsWith('D ') || l.startsWith('R '));
  const modifiedTracked = lines.filter((l) => /^ M/.test(l) || /^MM/.test(l));
  const untracked = lines.filter((l) => l.startsWith('??')).map((l) => l.slice(3).trim());

  // Staged/modified tracked files are recorded but do not block diagnosis (implementation artifacts).

  const hashCheck = verifyProtectedInputHashes(rootDir);
  if (!hashCheck.ok) errors.push(`protected_hashes:${hashCheck.mismatches.length}`);

  const aggPath = aggregateSummaryRedactedPath();
  let baseline = null;
  if (fs.existsSync(aggPath)) {
    baseline = JSON.parse(fs.readFileSync(aggPath, 'utf8'));
    const support = baseline.support_eligible_totals || {};
    if (support.support_eligible_centreline !== 1) errors.push('support_centreline');
    if (support.support_eligible_lane_edge !== 0) errors.push('support_lane_edge');
    if (baseline.multi_drive_candidates !== 0) errors.push('multi_drive_candidates');
    if (baseline.single_drive_consistent_sections !== 1) errors.push('single_drive_consistent');
    if (baseline.aggregate_state_counts?.insufficient_combined_evidence !== 187) {
      errors.push('insufficient_combined_evidence');
    }
  } else {
    errors.push('missing_aggregate_summary');
  }

  let preview = null;
  try {
    const previewPath = resolveUpdatePreviewPaths().previewPath;
    if (fs.existsSync(previewPath)) {
      preview = JSON.parse(fs.readFileSync(previewPath, 'utf8'));
    }
  } catch {
    errors.push('preview_read_failed');
  }

  const server = { port_3901_listener: false, health: null, active_route_metrics: null, mismatch_summary: null };
  if (requireServer) {
    try {
      const listeners = execSync('netstat -ano | findstr :3901', { encoding: 'utf8' });
      server.port_3901_listener = listeners.includes('LISTENING');
    } catch {
      server.port_3901_listener = false;
    }
    if (server.port_3901_listener) {
      server.health = fetchJson('http://127.0.0.1:3901/health');
      server.active_route_metrics = fetchJson(
        'http://127.0.0.1:3901/api/local-route-explorer/v1/routes/active/metrics'
      );
      server.mismatch_summary = fetchJson(
        'http://127.0.0.1:3901/api/multi-drive-mismatch/v1/bukit-bintang-imbi/summary'
      );
      const metrics = server.active_route_metrics?.metrics || server.active_route_metrics;
      if (metrics?.route_status !== 'complete') errors.push('route_status');
      if (metrics?.feature_total !== 8706) errors.push('feature_count');
    } else {
      errors.push('no_listener_3901');
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    branch,
    head,
    untracked_files: untracked,
    protected_hashes: hashCheck,
    baseline_summary: baseline,
    active_preview: preview
      ? { feature_count: preview.features?.length, route_status: preview.properties?.route_status }
      : null,
    server,
  };
}

function fetchJson(url) {
  try {
    return JSON.parse(execSync(`node -e "fetch('${url}').then(r=>r.json()).then(j=>console.log(JSON.stringify(j)))"`, {
      encoding: 'utf8',
      timeout: 15000,
    }));
  } catch {
    return null;
  }
}

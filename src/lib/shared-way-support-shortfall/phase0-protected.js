import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ROOT_DIR } from '../../config.js';
import { verifyProtectedInputHashes, readGitHead } from '../multi-drive-rebuild-guard.js';
import { updateEnvelopePath, resolveUpdatePreviewPaths } from '../update-preview-paths.js';
import { ROUTE_RESULTS_PRIVATE_PATH, probeRawPath } from '../bukit-page1-probe-paths.js';
import { EXPECTED_RAW_SHA256 } from '../multi-drive-mismatch-config.js';

export const EXPECTED_HEAD = 'fbe74aef0a25882a1b601eabe355db675a83c976';

function sha256File(p) {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

export function verifyPhase0({ rootDir = ROOT_DIR } = {}) {
  const errors = [];
  const head = readGitHead(rootDir);
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
  if (branch !== 'main') errors.push('branch');
  if (head !== EXPECTED_HEAD) errors.push('head');
  const porcelain = execSync('git status --porcelain', { cwd: rootDir, encoding: 'utf8' }).trim();
  if (porcelain) {
    const allow = (p) =>
      p.startsWith('src/lib/shared-way-support-shortfall/') ||
      p === 'scripts/run-shared-way-39914067-support-shortfall-v1.js' ||
      p.startsWith('tests/shared-way-39914067-support-shortfall') ||
      p.startsWith('reports/shared_way_39914067_support_shortfall_v1/');
    for (const line of porcelain.split('\n')) {
      const m = line.match(/^ M (.+)$/);
      const u = line.match(/^\?\? (.+)$/);
      if (m) errors.push('modified');
      if (u && !allow(u[1].replace(/\\/g, '/'))) errors.push('untracked');
    }
  }
  const hashes = verifyProtectedInputHashes(rootDir);
  if (!hashes.ok) errors.push('protected_hashes');
  const env = JSON.parse(fs.readFileSync(updateEnvelopePath(), 'utf8'));
  if (env.truncated || env.total_feature_count !== 8706) errors.push('active_source');
  const results = JSON.parse(fs.readFileSync(ROUTE_RESULTS_PRIVATE_PATH, 'utf8'));
  for (const ref of ['drive-005', 'drive-007']) {
    const r = results.routes.find((x) => x.probe_ref === ref);
    if (!r?.ok || r.truncated) errors.push(`incomplete:${ref}`);
    const raw = probeRawPath(ref);
    if (!fs.existsSync(raw) || sha256File(raw) !== r.sha256) errors.push(`hash:${ref}`);
  }
  const activeSha = sha256File(resolveUpdatePreviewPaths().previewPath);
  if (activeSha !== EXPECTED_RAW_SHA256['drive-active']) errors.push('active_hash');

  const acceptedPath = path.join(
    rootDir,
    'reports',
    'bukit_overlap_oriented_multi_drive_analysis_v1',
    'test_results.json'
  );
  let accepted = null;
  if (fs.existsSync(acceptedPath)) {
    accepted = JSON.parse(fs.readFileSync(acceptedPath, 'utf8'));
    if (accepted.verdict !== 'B' || accepted.diagnostic_proposal_count !== 0) errors.push('accepted_analysis');
  }

  return { ok: errors.length === 0, errors, head, branch, protected_hashes: hashes, accepted_analysis: accepted };
}

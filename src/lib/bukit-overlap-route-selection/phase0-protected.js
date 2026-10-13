import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { ROOT_DIR } from '../../config.js';
import { verifyProtectedInputHashes, readGitHead } from '../multi-drive-rebuild-guard.js';
import { resolveUpdatePreviewPaths, updateEnvelopePath } from '../update-preview-paths.js';

export const EXPECTED_HEAD = '5b6ffe17896d2c93dc39b6b0605f6d619901aee2';

export function verifyPhase0({ rootDir = ROOT_DIR, requireServer = false } = {}) {
  const errors = [];
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
  const head = readGitHead(rootDir);
  if (branch !== 'main') errors.push('branch');
  if (head !== EXPECTED_HEAD) errors.push('head');

  const porcelain = execSync('git status --porcelain', { cwd: rootDir, encoding: 'utf8' }).trim();
  const lines = porcelain ? porcelain.split('\n') : [];
  const allow = (p) =>
    p.startsWith('src/lib/bukit-overlap-route-selection/') ||
    p === 'scripts/run-bukit-overlap-oriented-route-selection-v1.js' ||
    p.startsWith('tests/bukit-overlap-oriented-route-selection') ||
    p.startsWith('reports/bukit_overlap_oriented_route_selection_v1/');
  for (const line of lines) {
    const m = line.match(/^ M (.+)$/);
    const u = line.match(/^\?\? (.+)$/);
    if (m) errors.push(`modified:${m[1]}`);
    if (u && !allow(u[1].replace(/\\/g, '/'))) errors.push(`untracked:${u[1]}`);
  }

  const hashCheck = verifyProtectedInputHashes(rootDir);
  if (!hashCheck.ok) errors.push('hashes');

  const envPath = updateEnvelopePath();
  let envelope = null;
  if (fs.existsSync(envPath)) {
    envelope = JSON.parse(fs.readFileSync(envPath, 'utf8'));
    if (envelope.truncated) errors.push('active_truncated');
    if (envelope.total_feature_count !== 8706) errors.push('active_features');
  } else errors.push('envelope_missing');

  return { ok: errors.length === 0, errors, head, branch, protected_hashes: hashCheck, envelope };
}

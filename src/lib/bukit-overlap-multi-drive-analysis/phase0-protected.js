import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { ROOT_DIR } from '../../config.js';
import { verifyProtectedInputHashes, readGitHead } from '../multi-drive-rebuild-guard.js';
import { updateEnvelopePath } from '../update-preview-paths.js';
import { ROUTE_RESULTS_PRIVATE_PATH } from '../bukit-page1-probe-paths.js';
import { createHash } from 'node:crypto';
import { probeRawPath } from '../bukit-page1-probe-paths.js';
import { resolveUpdatePreviewPaths } from '../update-preview-paths.js';
import { EXPECTED_RAW_SHA256 } from '../multi-drive-mismatch-config.js';

export const EXPECTED_HEAD = '053627c567ad9cf7ddf7923b42440845dfcc481a';

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
      p.startsWith('src/lib/bukit-overlap-multi-drive-analysis/') ||
      p === 'scripts/run-bukit-overlap-oriented-multi-drive-analysis-v1.js' ||
      p.startsWith('tests/bukit-overlap-oriented-multi-drive-analysis') ||
      p.startsWith('reports/bukit_overlap_oriented_multi_drive_analysis_v1/');
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
    if (!r?.ok || r.truncated || r.http_status !== 200) errors.push(`incomplete:${ref}`);
    const raw = probeRawPath(ref);
    if (!fs.existsSync(raw) || sha256File(raw) !== r.sha256) errors.push(`hash:${ref}`);
  }
  const activeSha = sha256File(resolveUpdatePreviewPaths().previewPath);
  if (activeSha !== EXPECTED_RAW_SHA256['drive-active']) errors.push('active_hash');
  const activeDongle = env.source_dongle;
  const d005 = results.routes.find((x) => x.probe_ref === 'drive-005')?.dongle;
  const d007 = results.routes.find((x) => x.probe_ref === 'drive-007')?.dongle;
  const distinct = new Set([activeDongle, d005, d007].filter(Boolean));
  if (distinct.size !== 3) errors.push('dongle_groups');
  return {
    ok: errors.length === 0,
    errors,
    head,
    branch,
    protected_hashes: hashes,
    dongle_count: distinct.size,
    private_dongle_fingerprints: {
      active: activeDongle ? createHash('sha256').update(activeDongle).digest('hex') : null,
      drive_005: d005 ? createHash('sha256').update(d005).digest('hex') : null,
      drive_007: d007 ? createHash('sha256').update(d007).digest('hex') : null,
    },
  };
}

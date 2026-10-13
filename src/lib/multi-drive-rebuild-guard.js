import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ROOT_DIR } from '../config.js';
import {
  MULTI_DRIVE_BASELINE_COMMIT,
  PROTECTED_INPUT_SHA256,
  MULTI_DRIVE_KEYS,
  driveSpec,
} from './multi-drive-mismatch-config.js';
import { localAreaGeojsonPath, FALLBACK_LOCAL_AREA_ID, DEFAULT_LOCAL_AREA_ID } from './local-areas.js';
import { summaryPath } from './lane-baseline-paths.js';
import { laneBaselineSummarySemanticDigestFromJsonText } from './lane-baseline-semantic-digest.js';

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function readGitHead(rootDir = ROOT_DIR) {
  return execSync('git rev-parse HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
}

/** Tracked-file changes only; untracked/ignored generated outputs do not block rebuild. */
export function trackedWorkingTreeClean(rootDir = ROOT_DIR) {
  const out = execSync('git status --porcelain --untracked-files=no', { cwd: rootDir, encoding: 'utf8' }).trim();
  return out.length === 0;
}

export function isBaselineAncestorOfHead(head, rootDir = ROOT_DIR, baseline = MULTI_DRIVE_BASELINE_COMMIT) {
  try {
    execSync(`git merge-base --is-ancestor ${baseline} ${head}`, { cwd: rootDir, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function protectedInputPaths() {
  return {
    bukit_osm: localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID),
    kinrara_osm: localAreaGeojsonPath(FALLBACK_LOCAL_AREA_ID),
    lane_baseline_summary: summaryPath(DEFAULT_LOCAL_AREA_ID),
    'drive-active': driveSpec('drive-active').raw_path,
    'drive-008': driveSpec('drive-008').raw_path,
    'drive-010': driveSpec('drive-010').raw_path,
    'drive-001': driveSpec('drive-001').raw_path,
  };
}

export function verifyProtectedInputHashes(rootDir = ROOT_DIR) {
  const paths = protectedInputPaths();
  const mismatches = [];
  for (const [key, expected] of Object.entries(PROTECTED_INPUT_SHA256)) {
    const filePath = paths[key];
    if (!filePath || !fs.existsSync(filePath)) {
      mismatches.push({ key, reason: 'missing', path: filePath });
      continue;
    }
    let actual;
    if (key === 'lane_baseline_summary') {
      actual = laneBaselineSummarySemanticDigestFromJsonText(fs.readFileSync(filePath, 'utf8'));
    } else {
      actual = sha256File(filePath);
    }
    if (actual !== expected) {
      mismatches.push({ key, reason: 'hash_mismatch', expected, actual });
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

export function assertRequiredDriveInputsExist() {
  const missing = [];
  for (const key of MULTI_DRIVE_KEYS) {
    const spec = driveSpec(key);
    if (!fs.existsSync(spec.raw_path)) missing.push(key);
  }
  return { ok: missing.length === 0, missing };
}

/**
 * Production regeneration guard: baseline ancestry, clean tracked tree, inputs present, hashes frozen.
 */
export function assertMultiDriveRebuildAllowed({
  rootDir = ROOT_DIR,
  head = readGitHead(rootDir),
  baseline = MULTI_DRIVE_BASELINE_COMMIT,
  trackedClean = trackedWorkingTreeClean(rootDir),
  verifyHashesFn = () => verifyProtectedInputHashes(rootDir),
} = {}) {
  if (!isBaselineAncestorOfHead(head, rootDir, baseline)) {
    const err = new Error(`HEAD ${head} is not a descendant of multi-drive baseline ${baseline}`);
    err.code = 'baseline_not_ancestor';
    throw err;
  }
  if (!trackedClean) {
    const err = new Error('Tracked working tree is not clean; commit or stash before regeneration');
    err.code = 'dirty_tracked_tree';
    throw err;
  }
  const inputs = assertRequiredDriveInputsExist();
  if (!inputs.ok) {
    const err = new Error(`Missing required drive inputs: ${inputs.missing.join(', ')}`);
    err.code = 'missing_inputs';
    throw err;
  }
  const hashes = verifyHashesFn();
  if (!hashes.ok) {
    const err = new Error(`Protected input hash mismatch: ${JSON.stringify(hashes.mismatches)}`);
    err.code = 'protected_hash_mismatch';
    throw err;
  }
  return { head, baseline };
}

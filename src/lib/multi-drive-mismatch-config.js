import path from 'node:path';
import { ROOT_DIR } from '../config.js';
import { resolveUpdatePreviewPaths } from './update-preview-paths.js';
import { probeRawPath } from './bukit-page1-probe-paths.js';

/** Expected raw SHA-256 (checkpoint); verified before each build. */
export const EXPECTED_RAW_SHA256 = {
  'drive-active': '1f1d223cf45687c777b8fb5f32108392791525eec16ee0dec3f93ce0f125d444',
  'drive-008': '0548713bc388237627d1d5edf4e5cb767692d65b62dff12378c3e54697fbb42e',
  'drive-010': 'bceb902f8acbb9c6b68317ca3ec4b878859a648002632c827a9e15c49f948d00',
  'drive-001': '33bf15444f77a0ddc679c5e94d335faa9c19e42e62bdcd37d568328eea8e97bb',
};

export const MULTI_DRIVE_KEYS = ['drive-active', 'drive-008', 'drive-010', 'drive-001'];

export function driveSpec(driveKey) {
  const redactedRef =
    driveKey === 'drive-active' ? 'active' : driveKey.replace('drive-', 'probe-');
  if (driveKey === 'drive-active') {
    const previewPath = resolveUpdatePreviewPaths().previewPath;
    return {
      drive_key: driveKey,
      drive_namespace: driveKey,
      redacted_drive_ref: 'active',
      raw_path: previewPath,
      raw_kind: 'active_preview',
    };
  }
  const probeRef = driveKey;
  return {
    drive_key: driveKey,
    drive_namespace: driveKey,
    redacted_drive_ref: redactedRef,
    raw_path: probeRawPath(probeRef),
    raw_kind: 'probe_page_1',
    probe_ref: probeRef,
  };
}

export function listMultiDriveSpecs() {
  return MULTI_DRIVE_KEYS.map(driveSpec);
}

/** Git commit that introduced Bukit multi-drive baseline (ancestor required, not exact HEAD). */
export const MULTI_DRIVE_BASELINE_COMMIT = '18bb638bae2e75380fb100ea664505cf36f82cd3';

/** @deprecated Use MULTI_DRIVE_BASELINE_COMMIT with merge-base guard instead of exact HEAD equality. */
export function expectedHeadCommit() {
  return MULTI_DRIVE_BASELINE_COMMIT;
}

/** SHA-256 of inputs that must not change for reproducible multi-drive regeneration. */
export const PROTECTED_INPUT_SHA256 = {
  bukit_osm: 'ea577ccf4f4a2e917e5814a515802539674316cc30f9ed9700aed2e366456111',
  kinrara_osm: '14280508680f9c0ad56928fe4dc91eacdd8c1c146e5738a70eb9e3af2e1ea945',
  /** Semantic digest (excludes generated_at); not raw summary file SHA-256. */
  lane_baseline_summary: '9048169d8a82737e48e38845c0305a216d26c2eb32cee785cbf84c49ffb280c6',
  'drive-active': EXPECTED_RAW_SHA256['drive-active'],
  'drive-008': EXPECTED_RAW_SHA256['drive-008'],
  'drive-010': EXPECTED_RAW_SHA256['drive-010'],
  'drive-001': EXPECTED_RAW_SHA256['drive-001'],
};

export function checkpointBackupDir() {
  return path.join(ROOT_DIR, '.checkpoint_test_backup', 'pre_bukit_multi_drive_mismatch_v1');
}

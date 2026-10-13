import fs from 'node:fs';
import crypto from 'node:crypto';
import { DRIVE_REF_MAP_PRIVATE_PATH } from './bukit-page1-probe-paths.js';
import { loadActiveSourceManifest } from './active-source-manifest.js';
import { MULTI_DRIVE_KEYS } from './multi-drive-mismatch-config.js';
import { resolveUpdatePreviewPaths } from './update-preview-paths.js';

function dongleFingerprint(dongleId) {
  return crypto.createHash('sha256').update(String(dongleId)).digest('hex').slice(0, 12);
}

/**
 * Build redacted dongle groups from actual ID equality (private file only).
 */
export function buildActualDongleGroups() {
  const driveMap = JSON.parse(fs.readFileSync(DRIVE_REF_MAP_PRIVATE_PATH, 'utf8'));
  const activeManifest = loadActiveSourceManifest();
  let activeDongle = null;
  const previewPath = resolveUpdatePreviewPaths().previewPath;
  if (fs.existsSync(previewPath)) {
    const meta = JSON.parse(fs.readFileSync(previewPath, 'utf8')).metadata;
    if (meta?.dongle_id) activeDongle = String(meta.dongle_id);
  }
  if (!activeDongle && activeManifest?.source_dongle_redacted) {
    activeDongle = `redacted:${activeManifest.source_dongle_redacted}`;
  }

  const rows = [];
  for (const key of MULTI_DRIVE_KEYS) {
    if (key === 'drive-active') {
      rows.push({
        drive_key: key,
        redacted_drive_ref: 'active',
        dongle_fingerprint: activeDongle ? dongleFingerprint(activeDongle) : 'unknown',
        _private_dongle_key: activeDongle,
      });
      continue;
    }
    const m = (driveMap.mappings || []).find((x) => x.probe_ref === key);
    const dongle = m?.dongle || null;
    rows.push({
      drive_key: key,
      redacted_drive_ref: key.replace('drive-', 'probe-'),
      dongle_fingerprint: dongle ? dongleFingerprint(dongle) : 'unknown',
      _private_dongle_key: dongle,
    });
  }

  const uniqueKeys = [...new Set(rows.map((r) => r._private_dongle_key).filter(Boolean))].sort();
  const groupByKey = new Map();
  uniqueKeys.forEach((k, i) => {
    groupByKey.set(k, `dongle-group-${String.fromCharCode(65 + i)}`);
  });

  const redacted = rows.map((r) => ({
    drive_key: r.drive_key,
    redacted_drive_ref: r.redacted_drive_ref,
    dongle_group: r._private_dongle_key ? groupByKey.get(r._private_dongle_key) : null,
  }));

  const groups = uniqueKeys.map((k) => ({
    dongle_group: groupByKey.get(k),
    drive_keys: redacted.filter((r) => groupByKey.get(k) === r.dongle_group).map((r) => r.drive_key),
  }));

  const privateGroups = uniqueKeys.map((k) => ({
    dongle_group: groupByKey.get(k),
    dongle_fingerprint: dongleFingerprint(k),
    drive_keys: redacted.filter((r) => groupByKey.get(k) === r.dongle_group).map((r) => r.drive_key),
  }));

  return {
    distinct_real_dongles: uniqueKeys.length,
    groups,
    drives: redacted,
    byDriveKey: new Map(redacted.map((r) => [r.drive_key, r])),
    privateGroups,
  };
}

/** Gitignored private manifest only — never expose via API or redacted JSON. */
export function privateDongleManifestSlice(audit) {
  return {
    distinct_real_dongles: audit.distinct_real_dongles,
    dongle_groups: audit.privateGroups || [],
    drives: audit.drives,
  };
}

export function redactedDongleAuditForReports(audit) {
  return {
    distinct_real_dongles: audit.distinct_real_dongles,
    groups: audit.groups,
    drives: audit.drives,
    active_group: audit.drives.find((d) => d.drive_key === 'drive-active')?.dongle_group,
    selected_groups: audit.drives
      .filter((d) => d.drive_key !== 'drive-active')
      .map((d) => ({ redacted_drive_ref: d.redacted_drive_ref, dongle_group: d.dongle_group })),
  };
}

import path from 'node:path';
import { mapsReadRootDir } from './maps-read-root.js';
import { MISMATCH_AREA_ID } from './mismatch-paths.js';

export const MULTI_DRIVE_VERSION = 'v1';
export const MULTI_DRIVE_AREA_ID = MISMATCH_AREA_ID;

export function multiDriveBaseDir(overrideRoot = null) {
  return overrideRoot || path.join(mapsReadRootDir(), 'multi-drive-mismatch-v1');
}

export function multiDrivePrivateDir(base = multiDriveBaseDir()) {
  return path.join(base, 'private');
}

export function multiDriveRedactedDir(base = multiDriveBaseDir()) {
  return path.join(base, 'redacted');
}

export function drivePrivateDir(driveKey, base = multiDriveBaseDir()) {
  return path.join(multiDrivePrivateDir(base), driveKey);
}

export function driveDerivedPreviewPath(driveKey, base = multiDriveBaseDir()) {
  return path.join(drivePrivateDir(driveKey, base), 'derived-preview.geojson');
}

export function driveComparisonDir(driveKey, base = multiDriveBaseDir()) {
  return path.join(drivePrivateDir(driveKey, base), 'pipeline', 'comparison-v1');
}

export function driveMismatchDir(driveKey, base = multiDriveBaseDir()) {
  return path.join(drivePrivateDir(driveKey, base), 'pipeline', 'mismatch-v1');
}

export function multiDrivePrivateManifestPath(base = multiDriveBaseDir()) {
  return path.join(multiDrivePrivateDir(base), 'private-manifest.json');
}

export function multiDriveDriveMappingPrivatePath(base = multiDriveBaseDir()) {
  return path.join(multiDrivePrivateDir(base), 'drive-mapping.private.json');
}

export function multiDriveDecisionStatePath(base = multiDriveBaseDir()) {
  return path.join(multiDrivePrivateDir(base), 'decision-state.json');
}

export function perDriveSummaryRedactedPath(base = multiDriveBaseDir()) {
  return path.join(multiDriveRedactedDir(base), 'per-drive-summary.json');
}

export function perDriveSectionsRedactedPath(base = multiDriveBaseDir()) {
  return path.join(multiDriveRedactedDir(base), 'per-drive-sections.geojson');
}

export function aggregateSummaryRedactedPath(base = multiDriveBaseDir()) {
  return path.join(multiDriveRedactedDir(base), 'aggregate-summary.json');
}

export function aggregateSectionsRedactedPath(base = multiDriveBaseDir()) {
  return path.join(multiDriveRedactedDir(base), 'aggregate-sections.geojson');
}

export function supportedCandidatesRedactedPath(base = multiDriveBaseDir()) {
  return path.join(multiDriveRedactedDir(base), 'supported-candidates.geojson');
}

export function singleDriveSignalsRedactedPath(base = multiDriveBaseDir()) {
  return path.join(multiDriveRedactedDir(base), 'single-drive-signals.geojson');
}

export function consistentSectionsRedactedPath(base = multiDriveBaseDir()) {
  return path.join(multiDriveRedactedDir(base), 'consistent-sections.geojson');
}

export function diagnosticsRedactedPath(base = multiDriveBaseDir()) {
  return path.join(multiDriveRedactedDir(base), 'diagnostics.geojson');
}

export function sensitivityRedactedPath(base = multiDriveBaseDir()) {
  return path.join(multiDriveRedactedDir(base), 'sensitivity.json');
}

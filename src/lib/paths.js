import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIRS, OSM, TILES, ROOT_DIR } from '../config.js';
import { DEFAULT_LOCAL_AREA_ID, localAreaGeojsonPath, localAreaMetaPath } from './local-areas.js';

export { DATA_DIRS };

export function ensureDataDirs() {
  for (const dir of Object.values(DATA_DIRS)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function pbfPath() {
  return path.join(DATA_DIRS.raw, OSM.pbfFilename);
}

export function md5Path() {
  return path.join(DATA_DIRS.raw, OSM.md5Filename);
}

export function pbfPartPath() {
  return path.join(DATA_DIRS.raw, `${OSM.pbfFilename}.part`);
}

export function roadsGeojsonSeqPath() {
  return path.join(DATA_DIRS.processed, 'roads.geojsonseq');
}

export function extractionMetaPath() {
  return path.join(DATA_DIRS.processed, 'extraction-meta.json');
}

export function datasetMetaPath() {
  return path.join(DATA_DIRS.processed, 'dataset-meta.json');
}

export function mbtilesPath() {
  return path.join(DATA_DIRS.tiles, TILES.mbtilesName);
}

export function downloadRecordPath() {
  return path.join(DATA_DIRS.raw, 'download-record.json');
}

export function mapConfigPath() {
  return path.join(ROOT_DIR, 'config', 'map.json');
}

export function roadStylesPath() {
  return path.join(ROOT_DIR, 'config', 'road-styles.json');
}

export function pilotAreaConfigPath() {
  return path.join(ROOT_DIR, 'config', 'pilot-area.json');
}

/** @deprecated use localAreaGeojsonPath(areaId) */
export function localAreaBandarKinraraGeojsonPath() {
  return localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID);
}

/** @deprecated use localAreaMetaPath(areaId) */
export function localAreaBandarKinraraMetaPath() {
  return localAreaMetaPath(DEFAULT_LOCAL_AREA_ID);
}

import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../config.js';
import { squareFromCentreExact2km, validateSquare } from './geo-square.js';

export const DEFAULT_LOCAL_AREA_ID = 'bukit-bintang-imbi';
export const FALLBACK_LOCAL_AREA_ID = 'bandar-kinrara';

const CONFIG_DIR = path.join(ROOT_DIR, 'config', 'local-areas');
const SAFE_AREA_ID = /^[a-z][a-z0-9-]*$/;

function configPathForId(areaId) {
  return path.join(CONFIG_DIR, `${areaId}.json`);
}

export function normalizeAreaId(raw) {
  if (raw == null) return null;
  const id = String(raw).trim().toLowerCase();
  if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) return null;
  if (!SAFE_AREA_ID.test(id)) return null;
  return id;
}

export function listConfiguredAreaIds() {
  if (!fs.existsSync(CONFIG_DIR)) return [];
  return fs
    .readdirSync(CONFIG_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((id) => SAFE_AREA_ID.test(id))
    .sort();
}

export function isConfiguredAreaId(areaId) {
  const id = normalizeAreaId(areaId);
  if (!id) return false;
  return fs.existsSync(configPathForId(id));
}

export function resolveAreaId(raw, { fallback = DEFAULT_LOCAL_AREA_ID } = {}) {
  const id = normalizeAreaId(raw);
  if (id && isConfiguredAreaId(id)) return id;
  if (isConfiguredAreaId(fallback)) return fallback;
  const ids = listConfiguredAreaIds();
  return ids[0] ?? fallback;
}

export function loadLocalAreaConfig(areaId) {
  const id = resolveAreaId(areaId);
  const filePath = configPathForId(id);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Unknown local area config: ${id}`);
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (raw.id !== id) {
    throw new Error(`Area config id mismatch: ${raw.id} !== ${id}`);
  }
  const lat = Number(raw.centre?.latitude);
  const lon = Number(raw.centre?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error(`Invalid centre for ${id}`);
  }
  const widthM = Number(raw.widthM ?? 2000);
  const heightM = Number(raw.heightM ?? 2000);
  const square = squareFromCentreExact2km(lon, lat);
  const validation = validateSquare(square);
  if (!validation.okSize || !validation.okMalaysia) {
    throw new Error(`Square validation failed for ${id}`);
  }
  return {
    id,
    displayName: String(raw.displayName || id),
    centre: { lat, lon },
    widthM,
    heightM,
    bounds: square.bounds,
    dimensions: {
      widthM: square.widthM,
      heightM: square.heightM,
      areaKm2: square.areaKm2,
    },
    subtitle: `${raw.displayName || id} · 2 km × 2 km`,
  };
}

export function localAreaGeojsonPath(areaId) {
  const id = resolveAreaId(areaId);
  return path.join(ROOT_DIR, 'data', 'local-area', `${id}-2km-roads.geojson`);
}

export function localAreaMetaPath(areaId) {
  const id = resolveAreaId(areaId);
  return path.join(ROOT_DIR, 'data', 'local-area', `${id}-2km-metadata.json`);
}

export function localAreaDataExists(areaId) {
  const id = resolveAreaId(areaId);
  return fs.existsSync(localAreaMetaPath(id)) && fs.existsSync(localAreaGeojsonPath(id));
}

export function listPublicLocalAreas() {
  return listConfiguredAreaIds().map((id) => {
    const cfg = loadLocalAreaConfig(id);
    let bounds = null;
    const metaPath = localAreaMetaPath(id);
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        bounds = meta.bounds ?? cfg.bounds;
      } catch {
        bounds = cfg.bounds;
      }
    }
    return {
      id: cfg.id,
      displayName: cfg.displayName,
      centre: { latitude: cfg.centre.lat, longitude: cfg.centre.lon },
      dimensions: cfg.dimensions,
      boundsAvailable: localAreaDataExists(id),
      bounds,
    };
  });
}

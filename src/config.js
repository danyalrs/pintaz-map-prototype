import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(ROOT, '.env') });

export const ROOT_DIR = ROOT;
export const PORT = Number(process.env.PORT || 3901);
export const HOST = process.env.HOST || '127.0.0.1';

export const MAPBOX_STYLE = 'mapbox://styles/mapbox/light-v11';

export const DATA_DIRS = {
  raw: path.join(ROOT, 'data', 'raw'),
  processed: path.join(ROOT, 'data', 'processed'),
  tiles: path.join(ROOT, 'data', 'tiles'),
};

export const OSM = {
  pbfUrl: 'https://download.geofabrik.de/asia/malaysia-singapore-brunei-latest.osm.pbf',
  md5Url: 'https://download.geofabrik.de/asia/malaysia-singapore-brunei-latest.osm.pbf.md5',
  pbfFilename: 'malaysia-singapore-brunei-latest.osm.pbf',
  md5Filename: 'malaysia-singapore-brunei-latest.osm.pbf.md5',
};

export const TILES = {
  storageFormat: 'tilemaker-mbtiles+served-directory',
  mbtilesName: 'roads.mbtiles',
  sourceId: 'osm-baseline-roads',
  layerPrefix: 'osm-baseline',
  minZoom: 10,
  maxZoom: 14,
};

export const REGION_VIEW = {
  center: [110, 4],
  zoom: 5,
};

/** Regional bounds for Malaysia–Singapore–Brunei extract (approximate). */
export const REGION_BOUNDS = {
  west: 98.5,
  south: 0.8,
  east: 119.5,
  north: 7.8,
};

export function loadMapboxTokenFromEnv() {
  const raw = (process.env.MAPBOX_ACCESS_TOKEN || '').trim();
  if (!raw) {
    return { token: null, error: 'missing' };
  }
  if (raw.startsWith('sk.')) {
    return { token: null, error: 'secret_token_rejected' };
  }
  if (!raw.startsWith('pk.')) {
    return { token: null, error: 'invalid_public_token' };
  }
  return { token: raw, error: null };
}

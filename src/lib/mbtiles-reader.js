import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { DATA_DIRS } from '../config.js';
import { xyzYToTmsRow } from './tile-encoding.js';

let dbPromise = null;
const MBTILES_PATH = path.join(DATA_DIRS.tiles, 'roads.mbtiles');

async function getDb() {
  if (!fs.existsSync(MBTILES_PATH)) return null;
  if (!dbPromise) {
    dbPromise = (async () => {
      const SQL = await initSqlJs();
      const buffer = fs.readFileSync(MBTILES_PATH);
      return new SQL.Database(buffer);
    })();
  }
  return dbPromise;
}

export async function readMbtilesTile(z, x, y) {
  const db = await getDb();
  if (!db) return null;
  const flippedY = xyzYToTmsRow(z, y);
  const stmt = db.prepare(
    'SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?'
  );
  stmt.bind([z, x, flippedY]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = stmt.getAsObject();
  stmt.free();
  const data = row.tile_data;
  if (!data) return null;
  return Buffer.from(data);
}

export function mbtilesPath() {
  return MBTILES_PATH;
}

export function mbtilesExists() {
  return fs.existsSync(MBTILES_PATH);
}

export async function mbtilesTileCount() {
  const db = await getDb();
  if (!db) return 0;
  const result = db.exec('SELECT COUNT(*) AS c FROM tiles');
  return result[0]?.values[0][0] ?? 0;
}

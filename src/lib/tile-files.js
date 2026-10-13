import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIRS, TILES } from '../config.js';

export function tilesRootDir() {
  return path.join(DATA_DIRS.tiles, 'roads');
}

export function tileFilePath(z, x, y) {
  return path.join(tilesRootDir(), String(z), String(x), `${y}.pbf`);
}

export function tileExists(z, x, y) {
  const file = tileFilePath(z, x, y);
  const root = path.resolve(tilesRootDir());
  const resolved = path.resolve(file);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    return false;
  }
  return fs.existsSync(resolved);
}

export function readTileFile(z, x, y) {
  const file = tileFilePath(z, x, y);
  const root = path.resolve(tilesRootDir());
  const resolved = path.resolve(file);
  if (!resolved.startsWith(root + path.sep)) {
    return null;
  }
  if (!fs.existsSync(resolved)) return null;
  return fs.readFileSync(resolved);
}

export function countTileFiles() {
  const root = tilesRootDir();
  if (!fs.existsSync(root)) return 0;
  let count = 0;
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith('.pbf')) count += 1;
    }
  };
  walk(root);
  return count;
}

export function tilesDiskSizeBytes() {
  const root = tilesRootDir();
  if (!fs.existsSync(root)) return 0;
  let total = 0;
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else total += st.size;
    }
  };
  walk(root);
  return total;
}

export function tileFormatLabel() {
  return TILES.storageFormat || 'tippecanoe-directory';
}

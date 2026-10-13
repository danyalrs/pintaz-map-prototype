import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT_DIR } from '../src/config.js';

const CANDIDATES = [
  path.join(ROOT_DIR, 'tools', 'tilemaker-v2', 'build', 'RelWithDebInfo', 'tilemaker.exe'),
  path.join(ROOT_DIR, 'tools', 'tilemaker', 'build', 'RelWithDebInfo', 'tilemaker.exe'),
  path.join(ROOT_DIR, 'tools', 'tilemaker', 'tilemaker.exe'),
];

export function resolveTilemaker() {
  for (const candidate of CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const which = spawnSync('where', ['tilemaker'], { shell: true, encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) {
    return which.stdout.trim().split(/\r?\n/)[0];
  }
  return null;
}

export function printTilemakerInstallHelp() {
  console.error(`
Official tilemaker (Windows) is required.

1. Download the official release asset from:
   https://github.com/systemed/tilemaker/releases/tag/v2.4.0
   Asset: tilemaker-windows.zip
2. Extract to:
   ${path.join(ROOT_DIR, 'tools', 'tilemaker-v2')}
3. Re-run: npm run build:tiles

See docs/DATA_PIPELINE.md
`);
}

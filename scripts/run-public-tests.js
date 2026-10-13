#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'scripts', 'public-test-files.json'), 'utf8')
);

for (const rel of manifest) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.error(`public test manifest missing file: ${rel}`);
    process.exit(1);
  }
}

const result = spawnSync(process.execPath, ['--test', ...manifest.map((f) => path.join(ROOT, f))], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, PINTAZ_PUBLIC_TEST_SUITE: '1' },
});

process.exit(result.status ?? 1);

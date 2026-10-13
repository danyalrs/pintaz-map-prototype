import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

test('gitignore excludes data and secrets', () => {
  assert.match(gi, /^\.env$/m);
  assert.match(gi, /data\/raw\//);
  assert.match(gi, /data\/processed\//);
  assert.match(gi, /data\/tiles\//);
  assert.match(gi, /data\/maps-read\//);
  assert.match(gi, /\*\.osm\.pbf/);
  assert.match(gi, /node_modules\//);
});

test('tracked files do not contain mapbox token patterns', () => {
  const walk = (dir, acc = []) => {
    for (const name of fs.readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git' || name === 'data') continue;
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p, acc);
      else if (/\.(js|json|md|html|css|example)$/.test(name)) acc.push(p);
    }
    return acc;
  };
  const files = walk(root);
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(text, /pk\.ey[a-zA-Z0-9]{20,}/);
    assert.doesNotMatch(text, /sk\.ey[a-zA-Z0-9]{20,}/);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appJs = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'public', 'app.js'),
  'utf8'
);

test('overlay toggle drives detailed road layer visibility', () => {
  assert.match(appJs, /overlay-toggle/);
  assert.match(appJs, /applyRoadDisplayOptions/);
  assert.match(appJs, /show-paths/);
});

test('2 km fit control present', () => {
  const html = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'public', 'index.html'),
    'utf8'
  );
  assert.match(appJs, /fit-2km/);
  assert.match(html, /Fit 2 km area/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTilemaker } from '../scripts/resolve-tilemaker.js';

test('resolve official tilemaker windows binary', () => {
  const exe = resolveTilemaker();
  assert.ok(exe);
  assert.match(exe.toLowerCase(), /tilemaker\.exe$/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTileParams, isSafePathSegment } from '../src/lib/tile-coords.js';

test('valid tile coords', () => {
  const r = parseTileParams('10', '512', '384');
  assert.equal(r.ok, true);
  assert.deepEqual({ z: r.z, x: r.x, y: r.y }, { z: 10, x: 512, y: 384 });
});

test('invalid tile coords', () => {
  assert.equal(parseTileParams('10', '99999', '0').ok, false);
  assert.equal(parseTileParams('x', '1', '1').ok, false);
});

test('path traversal rejected', () => {
  assert.equal(isSafePathSegment('..'), false);
  assert.equal(isSafePathSegment('roads'), true);
});

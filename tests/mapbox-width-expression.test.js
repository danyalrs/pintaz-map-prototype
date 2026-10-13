import { test } from 'node:test';
import assert from 'node:assert/strict';
import { widthExpression, casingWidthExpression } from '../src/lib/road-style-taxonomy.js';

test('line-width expressions use top-level interpolate (Mapbox-compatible)', () => {
  for (const category of ['primary', 'service', 'footway_path_track', 'motorway_trunk']) {
    assert.equal(widthExpression(category)[0], 'interpolate');
    assert.equal(casingWidthExpression(category)[0], 'interpolate');
    assert.equal(widthExpression(category).includes('case'), false);
  }
});

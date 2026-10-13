import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldApplyMapResize } from '../src/public/map-resize.js';

test('shouldApplyMapResize ignores zero dimensions', () => {
  assert.equal(shouldApplyMapResize(100, 200, 0, 200), false);
  assert.equal(shouldApplyMapResize(100, 200, 100, 0), false);
});

test('shouldApplyMapResize ignores duplicate size', () => {
  assert.equal(shouldApplyMapResize(640, 480, 640, 480), false);
});

test('shouldApplyMapResize reacts to real size changes', () => {
  assert.equal(shouldApplyMapResize(640, 480, 641, 480), true);
  assert.equal(shouldApplyMapResize(640, 480, 640, 481), true);
});

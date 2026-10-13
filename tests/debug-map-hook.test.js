import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDebugMapExposure,
  debugMapParamEnabled,
  isLocalhostHostname,
  shouldExposeDebugMap,
} from '../src/lib/debug-map-hook.js';

test('debug-map=1 in query enables hook on localhost only', () => {
  assert.equal(isLocalhostHostname('127.0.0.1'), true);
  assert.equal(isLocalhostHostname('localhost'), true);
  assert.equal(isLocalhostHostname('example.com'), false);
  assert.equal(debugMapParamEnabled('?area=bukit&debug-map=1'), true);
  assert.equal(debugMapParamEnabled('?area=bukit'), false);
  assert.equal(debugMapParamEnabled('?debug-map=0'), false);
  assert.equal(shouldExposeDebugMap('127.0.0.1', '?debug-map=1'), true);
  assert.equal(shouldExposeDebugMap('localhost', '&debug-map=1'), true);
  assert.equal(shouldExposeDebugMap('127.0.0.1', '?area=x'), false);
  assert.equal(shouldExposeDebugMap('example.com', '?debug-map=1'), false);
});

test('applyDebugMapExposure sets or removes __pintazMap', () => {
  const map = { jumpTo() {} };
  const win = {};
  applyDebugMapExposure(map, win, '127.0.0.1', '?debug-map=1');
  assert.equal(win.__pintazMap, map);
  applyDebugMapExposure(map, win, '127.0.0.1', '');
  assert.equal(win.__pintazMap, undefined);
  applyDebugMapExposure(map, win, '127.0.0.1', '?debug-map=1');
  assert.equal(win.__pintazMap, map);
  applyDebugMapExposure(map, win, 'evil.test', '?debug-map=1');
  assert.equal(win.__pintazMap, undefined);
});

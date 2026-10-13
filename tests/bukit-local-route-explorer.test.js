import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  OBSERVATION_ROUTES,
  isAllowedObservationRouteKey,
} from '../src/lib/local-route-explorer/config.js';
import { bootstrapLocalRouteExplorer } from '../src/lib/local-route-explorer/bootstrap.js';
import { probeRawPath } from '../src/lib/bukit-page1-probe-paths.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
test('observation route catalog lists six complete routes', () => {
  assert.equal(OBSERVATION_ROUTES.length, 6);
  assert.equal(isAllowedObservationRouteKey('active'), true);
  assert.equal(isAllowedObservationRouteKey('drive-999'), false);
  assert.ok(OBSERVATION_ROUTES.some((r) => r.route_key === 'drive-005'));
});

test('bootstrap writes derived preview without modifying raw probe bytes', () => {
  const rawPath = probeRawPath('drive-005');
  if (!fs.existsSync(rawPath)) return;
  const before = crypto.createHash('sha256').update(fs.readFileSync(rawPath)).digest('hex');
  const result = bootstrapLocalRouteExplorer();
  const after = crypto.createHash('sha256').update(fs.readFileSync(rawPath)).digest('hex');
  assert.equal(before, after);
  assert.equal(result.ok, true);
});

test('index exposes observation route selector', () => {
  const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/public/index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /id="observation-route-selector"/);
  assert.match(html, /Observation route/);
  assert.match(html, /Diagnostic local route/);
});

test('explorer route labels omit dongle identifiers', () => {
  for (const r of OBSERVATION_ROUTES) {
    assert.doesNotMatch(r.option_label, /dongle/i);
    assert.doesNotMatch(r.option_label, /0x[0-9a-f]+/i);
  }
});

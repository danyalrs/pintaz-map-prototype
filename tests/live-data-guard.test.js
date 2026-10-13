import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveCompleteRouteSnapshot } from './helpers/isolated-maps-read-fixture.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('full test run does not mutate live complete-route bundle', (t) => {
  if (process.env.PINTAZ_LIVE_DATA_GUARD) {
    return t.skip('guard child process');
  }
  const before = liveCompleteRouteSnapshot();
  if (!before || before.route_status !== 'complete' || before.total_features !== 8706) {
    return t.skip('live complete route bundle not present');
  }

  const result = spawnSync(process.execPath, ['--test', 'tests'], {
    cwd: root,
    env: { ...process.env, PINTAZ_LIVE_DATA_GUARD: '1' },
    stdio: 'pipe',
    timeout: 180_000,
  });

  assert.equal(
    result.status,
    0,
    `npm test failed in guard subprocess:\n${result.stderr?.toString().slice(0, 2000)}`
  );

  const after = liveCompleteRouteSnapshot();
  assert.equal(after.previewSha256, before.previewSha256);
  assert.equal(after.envelopeSha256, before.envelopeSha256);
  assert.equal(after.route_status, 'complete');
  assert.equal(after.total_features, 8706);
});

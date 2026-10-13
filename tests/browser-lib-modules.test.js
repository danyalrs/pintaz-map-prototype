import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

test('browser lib modules are served for ES module imports', async () => {
  process.env.PINTAZ_TEST = '1';
  const { app } = await import('../src/server.js');
  await new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', async () => {
      const { port } = server.address();
      const base = `http://127.0.0.1:${port}`;
      try {
        for (const path of [
          '/lib/road-style-taxonomy.js',
          '/lib/road-click-info.js',
          '/lib/update-observation-info.js',
          '/lib/update-preview-click.js',
          '/lib/road-lane-info.js',
          '/lib/format-display.js',
        ]) {
          const res = await fetch(`${base}${path}`);
          assert.equal(res.status, 200, path);
          const body = await res.text();
          assert.match(body, /export /);
        }
        server.close();
        resolve();
      } catch (e) {
        server.close();
        reject(e);
      }
    });
    server.on('error', reject);
  });
});

test('app module graph imports resolve under /lib', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = path.dirname(fileURLToPath(import.meta.url));
  const appJs = fs.readFileSync(path.join(root, '..', 'src', 'public', 'app.js'), 'utf8');
  const selectionJs = fs.readFileSync(path.join(root, '..', 'src', 'public', 'map-selection.js'), 'utf8');
  const layersJs = fs.readFileSync(
    path.join(root, '..', 'src', 'public', 'detailed-road-layers.js'),
    'utf8'
  );
  assert.match(selectionJs, /road-click-info\.js/);
  assert.match(appJs, /map-selection\.js/);
  assert.match(layersJs, /road-style-taxonomy\.js/);
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.PINTAZ_TEST = '1';
process.env.MAPBOX_ACCESS_TOKEN = '';

const { app } = await import('../src/server.js');

function request(path) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      http
        .get(`http://127.0.0.1:${port}${path}`, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            server.close();
            resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
          });
        })
        .on('error', (e) => {
          server.close();
          reject(e);
        });
    });
  });
}

test('GET /health', async () => {
  const r = await request('/health');
  assert.equal(r.status, 200);
  assert.match(r.body.toString(), /"ok":true/);
});

test('GET /api/config without token', async () => {
  const r = await request('/api/config');
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body.toString());
  assert.equal(j.mapbox.configured, false);
  assert.equal(j.mapbox.tokenError, 'missing');
});

test('missing tile 404', async () => {
  const r = await request('/tiles/roads/10/512/384.pbf');
  assert.equal(r.status, 404);
});

test('invalid tile coords 400', async () => {
  const r = await request('/tiles/roads/99/0/0.pbf');
  assert.equal(r.status, 400);
});

test('known tile serves vector MVT headers when present on disk', async () => {
  const sample = 'tiles/roads/12/3181/1975.pbf';
  const fs = await import('node:fs');
  const path = await import('node:path');
  const file = path.join('data', sample);
  if (!fs.existsSync(file)) {
    return;
  }
  const r = await request(`/${sample}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'application/vnd.mapbox-vector-tile');
  if (r.body[0] === 0x1f && r.body[1] === 0x8b) {
    assert.equal(r.headers['content-encoding'], 'gzip');
  }
});

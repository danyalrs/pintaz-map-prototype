import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.MAPBOX_ACCESS_TOKEN = '';
const { loadMapboxTokenFromEnv, OSM } = await import('../src/config.js');

test('missing Mapbox token', () => {
  const r = loadMapboxTokenFromEnv();
  assert.equal(r.token, null);
  assert.equal(r.error, 'missing');
});

test('rejects secret sk token', () => {
  process.env.MAPBOX_ACCESS_TOKEN = 'sk.fake_secret_token_value';
  const r = loadMapboxTokenFromEnv();
  assert.equal(r.token, null);
  assert.equal(r.error, 'secret_token_rejected');
  process.env.MAPBOX_ACCESS_TOKEN = '';
});

test('accepts public pk token', () => {
  process.env.MAPBOX_ACCESS_TOKEN = 'pk.test_public_token_only';
  const r = loadMapboxTokenFromEnv();
  assert.equal(r.token, 'pk.test_public_token_only');
  assert.equal(r.error, null);
  process.env.MAPBOX_ACCESS_TOKEN = '';
});

test('official Geofabrik URLs', () => {
  assert.match(OSM.pbfUrl, /geofabrik\.de\/asia\/malaysia-singapore-brunei-latest\.osm\.pbf$/);
  assert.match(OSM.md5Url, /\.md5$/);
});

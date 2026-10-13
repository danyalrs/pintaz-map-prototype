import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  isGzipTile,
  prepareVectorTileResponse,
  xyzYToTmsRow,
  tmsRowToXyzY,
} from '../src/lib/tile-encoding.js';

test('XYZ/TMS row conversion is symmetric', () => {
  for (const z of [10, 12, 14]) {
    const max = (1 << z) - 1;
    for (const y of [0, 1, max >> 1, max]) {
      const tms = xyzYToTmsRow(z, y);
      assert.equal(tmsRowToXyzY(z, tms), y);
    }
  }
});

test('detects gzip magic on sample tile', () => {
  const sample = path.join('data', 'tiles', 'roads', '12', '3181', '1975.pbf');
  if (!fs.existsSync(sample)) {
    return;
  }
  const buf = fs.readFileSync(sample);
  assert.equal(isGzipTile(buf), true);
  const { headers } = prepareVectorTileResponse(buf);
  assert.equal(headers['Content-Type'], 'application/vnd.mapbox-vector-tile');
  assert.equal(headers['Content-Encoding'], 'gzip');
});

test('uncompressed tile has no Content-Encoding', () => {
  const raw = Buffer.from([0x1a, 0x2b, 0x3c]);
  const { headers } = prepareVectorTileResponse(raw);
  assert.equal(headers['Content-Encoding'], undefined);
});

test('gzip tile decodes to MVT with roads layer', async () => {
  const sample = path.join('data', 'tiles', 'roads', '12', '3181', '1975.pbf');
  if (!fs.existsSync(sample)) {
    return;
  }
  let VectorTile;
  let Pbf;
  try {
    ({ VectorTile } = await import('@mapbox/vector-tile'));
    Pbf = (await import('pbf')).default;
  } catch {
    return;
  }
  const buf = fs.readFileSync(sample);
  const raw = isGzipTile(buf) ? zlib.gunzipSync(buf) : buf;
  const vt = new VectorTile(new Pbf(raw));
  assert.ok(vt.layers.roads);
  assert.ok(vt.layers.roads.length > 0);
  const props = vt.layers.roads.feature(0).properties;
  assert.ok(props.highway);
  assert.ok(props.osm_id);
});

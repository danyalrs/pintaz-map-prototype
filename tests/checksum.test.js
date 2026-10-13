import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMd5Sidecar } from '../src/lib/checksum.js';

test('parse md5 sidecar hex only', () => {
  assert.equal(parseMd5Sidecar('abc123def456789012345678901234ab\n'), 'abc123def456789012345678901234ab');
});

test('parse md5 sidecar with filename', () => {
  assert.equal(
    parseMd5Sidecar('d41d8cd98f00b204e9800998ecf8427e  malaysia-singapore-brunei-latest.osm.pbf\n'),
    'd41d8cd98f00b204e9800998ecf8427e'
  );
});

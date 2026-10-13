import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNonStandardJsonNumericTokens } from '../src/lib/json-nan-normalize.js';
import {
  parseMapsReadGeoJsonFromUtf8,
  isValidMapsReadObservationFeature,
  sanitizeMapsReadFeatureCollection,
} from '../src/lib/full-maps-read-route-enrichment-discovery/parse-maps-read-geojson.js';

test('bare NaN numeric field becomes null', () => {
  const { normalized, replacementCount, nanCount } = normalizeNonStandardJsonNumericTokens(
    '{"t":NaN,"ok":1}'
  );
  assert.equal(replacementCount, 1);
  assert.equal(nanCount, 1);
  assert.deepEqual(JSON.parse(normalized), { t: null, ok: 1 });
});

test('quoted NaN remains a string', () => {
  const { normalized, replacementCount } = normalizeNonStandardJsonNumericTokens('{"t":"NaN"}');
  assert.equal(replacementCount, 0);
  assert.deepEqual(JSON.parse(normalized), { t: 'NaN' });
});

test('Infinity and -Infinity become null outside strings', () => {
  const { normalized, infinityCount, negativeInfinityCount } = normalizeNonStandardJsonNumericTokens(
    '{"a":Infinity,"b":-Infinity}'
  );
  assert.equal(infinityCount, 1);
  assert.equal(negativeInfinityCount, 1);
  assert.deepEqual(JSON.parse(normalized), { a: null, b: null });
});

test('invalid-coordinate vehicle_pose feature is dropped', () => {
  const text = `{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[NaN,3.15]},"properties":{"layer":"vehicle_pose","frame_id":1}}]}`;
  const parsed = parseMapsReadGeoJsonFromUtf8(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.stats.malformed_observations_dropped, 1);
  assert.equal(parsed.geojson.features.length, 0);
});

test('malformed one route does not stop a batch of parse outcomes', () => {
  const batch = [
    parseMapsReadGeoJsonFromUtf8('{"type":"FeatureCollection","features":[]}'),
    parseMapsReadGeoJsonFromUtf8('{"t":NaN'),
    parseMapsReadGeoJsonFromUtf8('{"type":"FeatureCollection","features":[]}'),
  ];
  const statuses = batch.map((r) => (r.ok ? 'ok' : 'malformed_response'));
  assert.deepEqual(statuses, ['ok', 'malformed_response', 'ok']);
});

test('null model_y_m lane_point dropped from sanitize', () => {
  const feature = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [101.71, 3.15] },
    properties: { layer: 'lane_point', frame_id: 1, model_y_m: null, lane_probability: 0.9 },
  };
  assert.equal(isValidMapsReadObservationFeature(feature), false);
  const out = sanitizeMapsReadFeatureCollection({ type: 'FeatureCollection', features: [feature] });
  assert.equal(out.malformed_observations_dropped, 1);
});

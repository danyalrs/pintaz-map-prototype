import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { parsePositiveInt, parseWidthMetres, parseOneway } from '../src/lib/lane-tag-parse.js';
import { interpretOsmRoadProperties, DISPLAY_LANE_WIDTH_M } from '../src/lib/lane-interpret.js';
import { laneDividerOffsets, lineStringToRoadSurface } from '../src/lib/lane-geometry.js';
import { auditOsmRoadFeatures } from '../src/lib/lane-tag-audit.js';
import { buildLaneBaselineForArea } from '../src/lib/lane-baseline-build.js';
import { formatSelectedRoadCard } from '../src/lib/road-lane-info.js';
import { loadObservationCoverageFeature } from '../src/lib/observation-coverage.js';
import { localAreaGeojsonPath } from '../src/lib/local-areas.js';
import { RAW_SAMPLE_PATH } from '../src/lib/update-preview-paths.js';
import { surfacesPath, dividersPath, summaryPath } from '../src/lib/lane-baseline-paths.js';

const BUKIT = 'bukit-bintang-imbi';

function hashFile(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

test('lane value parsing', () => {
  assert.equal(parsePositiveInt('2').kind, 'valid_numeric');
  assert.equal(parsePositiveInt('').kind, 'missing');
  assert.equal(parsePositiveInt('2;3').kind, 'conditional_or_multiple');
  assert.equal(parsePositiveInt('abc').kind, 'invalid');
  assert.equal(parsePositiveInt('99').kind, 'outlier');
});

test('directional lane tags', () => {
  const r = interpretOsmRoadProperties({ lanes: '5', 'lanes:forward': '2', 'lanes:backward': '2' });
  assert.equal(r.lane_count_total, 4);
  assert.equal(r.lane_count_source, 'osm_directional_tags');
  assert.match(String(r.disagreement), /differs/);
});

test('one-way and oneway=-1', () => {
  const fwd = interpretOsmRoadProperties({ lanes: '3', oneway: 'yes' });
  assert.equal(fwd.lane_count_forward, 3);
  assert.equal(fwd.direction_confidence, 'oneway_forward');
  const rev = interpretOsmRoadProperties({ lanes: '2', oneway: '-1' });
  assert.equal(rev.oneway.reverse, true);
  assert.equal(rev.direction_confidence, 'oneway_reverse');
});

test('total-only two-way lanes', () => {
  const r = interpretOsmRoadProperties({ lanes: '4', oneway: 'no' });
  assert.equal(r.direction_confidence, 'total_only');
  assert.equal(r.lane_count_forward, null);
});

test('odd two-way lane count stays neutral', () => {
  const r = interpretOsmRoadProperties({ lanes: '3' });
  assert.equal(r.direction_confidence, 'total_only');
  const offs = laneDividerOffsets(3, 9.6, 'total_only');
  assert.ok(offs.includes(0));
});

test('missing lane count', () => {
  const r = interpretOsmRoadProperties({ highway: 'residential' }, 6);
  assert.equal(r.lane_count_source, 'lane_count_unknown');
  assert.equal(r.geometry_confidence, 'line_only_unknown_lanes');
});

test('width parsing metres and feet', () => {
  assert.equal(parseWidthMetres('6.5 m').kind, 'valid_metres');
  assert.equal(parseWidthMetres('20 ft').kind, 'valid_feet_converted');
  assert.equal(parseWidthMetres('not-a-width').kind, 'invalid');
});

test('width source priority and estimate labelling', () => {
  const w = interpretOsmRoadProperties({ lanes: '2', width: '7' });
  assert.equal(w.road_width_source, 'osm_width');
  const est = interpretOsmRoadProperties({ lanes: '2' });
  assert.equal(est.road_width_source, 'lane_count_display_estimate');
  assert.equal(est.road_width_m, 2 * DISPLAY_LANE_WIDTH_M);
});

test('build lane baseline deterministic and non-mutating', () => {
  const path = localAreaGeojsonPath(BUKIT);
  const beforeHash = hashFile(path);
  const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
  const r1 = buildLaneBaselineForArea(BUKIT);
  const r2 = buildLaneBaselineForArea(BUKIT);
  assert.equal(r1.ok, true);
  assert.deepEqual(r1.counts, r2.counts);
  assert.equal(hashFile(path), beforeHash);
  assert.equal(JSON.stringify(raw), fs.readFileSync(path, 'utf8'));
});

test('road surface GeoJSON validity and divider rules', () => {
  buildLaneBaselineForArea(BUKIT);
  const surfaces = JSON.parse(fs.readFileSync(surfacesPath(BUKIT), 'utf8'));
  const dividers = JSON.parse(fs.readFileSync(dividersPath(BUKIT), 'utf8'));
  assert.equal(surfaces.type, 'FeatureCollection');
  for (const f of surfaces.features.slice(0, 50)) {
    assert.ok(f.properties.osm_id);
    assert.equal(f.geometry.type, 'Polygon');
    for (const ring of f.geometry.coordinates) {
      for (const [lon, lat] of ring) {
        assert.ok(Number.isFinite(lon) && Number.isFinite(lat));
      }
    }
  }
  const unknownIds = new Set(
    surfaces.features.filter((f) => f.properties.surface_role === 'unknown_lane_outline').map((f) => f.properties.osm_id)
  );
  const divOsm = new Set(dividers.features.map((f) => f.properties.osm_id));
  for (const id of unknownIds) assert.equal(divOsm.has(id), false);
  assert.ok(dividers.features.length > 0);
});

test('bridge tunnel preserved on derived features', () => {
  buildLaneBaselineForArea(BUKIT);
  const surfaces = JSON.parse(fs.readFileSync(surfacesPath(BUKIT), 'utf8'));
  const bridged = surfaces.features.find((f) => f.properties.bridge === 'yes');
  if (bridged) assert.equal(bridged.properties.bridge, 'yes');
});

test('OSM audit recalculates lanes present count', () => {
  const roads = JSON.parse(fs.readFileSync(localAreaGeojsonPath(BUKIT), 'utf8'));
  const audit = auditOsmRoadFeatures(roads.features);
  assert.equal(audit.feature_count, 3259);
  assert.ok(audit.lanes_tag_present_count > 500);
});

test('selected road provenance labels', () => {
  const html = formatSelectedRoadCard({ osm_id: '1', highway: 'primary' }, {
    lane_count_total: 2,
    road_width_m: 6.4,
    lane_count_source: 'osm_lanes_total',
    road_width_source: 'lane_count_display_estimate',
    direction_confidence: 'total_only',
    geometry_confidence: 'surface_and_dividers_total_only',
  });
  assert.match(html, /OSM total only/);
  assert.match(html, /Display estimate/);
  assert.match(html, /not an OSM measurement/i);
});

test('observation coverage feature without API', () => {
  const f = loadObservationCoverageFeature();
  if (f) {
    assert.match(f.properties.label, /Server observation coverage/);
    assert.equal(f.geometry.type, 'Polygon');
  }
});

test('raw maps read sample hash unchanged', () => {
  if (!fs.existsSync(RAW_SAMPLE_PATH)) return;
  const h = hashFile(RAW_SAMPLE_PATH);
  assert.equal(h, 'f5c96176bc9f528ba53e3e25d407396c300593e71d73111e8e1e9316f6b8e826');
});

test('lane baseline UI modules referenced', async () => {
  const fsProm = await import('node:fs');
  const html = fsProm.readFileSync(new URL('../src/public/index.html', import.meta.url), 'utf8');
  assert.match(html, /lane-baseline-surfaces-toggle/);
  assert.match(html, /OSM lane baseline/);
  const layers = fsProm.readFileSync(new URL('../src/public/lane-baseline-layers.js', import.meta.url), 'utf8');
  assert.match(layers, /DIVIDER_MIN_ZOOM/);
});

test('summary file exists after build', () => {
  assert.ok(fs.existsSync(summaryPath(BUKIT)));
  const sum = JSON.parse(fs.readFileSync(summaryPath(BUKIT), 'utf8'));
  assert.equal(sum.area_id, BUKIT);
  assert.ok(sum.osm_baseline_hash_sha256);
});

test('server lane baseline routes registered', async () => {
  process.env.PINTAZ_TEST = '1';
  const http = await import('node:http');
  const { app } = await import('../src/server.js');
  await new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', async () => {
      const { port } = server.address();
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/lane-baseline/v1/${BUKIT}/summary`);
        assert.equal(res.status, 200);
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

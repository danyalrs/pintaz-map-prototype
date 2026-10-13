import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildOsmSegmentIndex } from '../src/lib/osm-segment-index.js';
import { headingDifferenceDeg, pointToSegmentMetres } from '../src/lib/geo-segment.js';
import { matchVehiclePoses, sortPoses, onewayCompatible } from '../src/lib/vehicle-osm-matcher.js';
import {
  confidenceScore,
  classifySection,
  proposalPassesDisplayGate,
  groupMatchedPosesIntoSections,
} from '../src/lib/comparison-sections.js';
import { attachObservationsToPoses, buildPoseLookup } from '../src/lib/comparison-lane-attach.js';
import { comparisonSensitivityPath } from '../src/lib/comparison-paths.js';
import { buildObservationOsmComparison } from '../src/lib/comparison-build.js';
import { applyProposalDecision, loadProposalDecisions } from '../src/lib/comparison-decisions.js';
import { comparisonSummaryPath, roadSectionsPath } from '../src/lib/comparison-paths.js';
import { localAreaGeojsonPath } from '../src/lib/local-areas.js';
import { RAW_SAMPLE_PATH } from '../src/lib/update-preview-paths.js';
import { prepareUpdatePreviewFromRaw, PAGE1_EXPECTED } from '../src/lib/update-preview-prepare.js';
import {
  createIsolatedMapsReadFixture,
  cleanupIsolatedMapsReadFixture,
  withIsolatedMapsReadRoot,
} from './helpers/isolated-maps-read-fixture.js';

test('OSM segment index builds segments', () => {
  const roads = JSON.parse(fs.readFileSync(localAreaGeojsonPath('bukit-bintang-imbi'), 'utf8'));
  const idx = buildOsmSegmentIndex(roads);
  assert.ok(idx.segments.length > 3000);
  assert.ok(idx.segments[0].osm_id);
});

test('point to segment distance', () => {
  const d = pointToSegmentMetres(101.71, 3.15, 101.71, 3.15, 101.711, 3.15);
  assert.ok(d.distanceM < 50);
});

test('heading difference wraps 0/360', () => {
  assert.equal(headingDifferenceDeg(10, 350), 20);
  assert.equal(headingDifferenceDeg(0, 180), 180);
});

test('confidence score is transparent and bounded', () => {
  const low = confidenceScore({ frameCount: 2, sectionLengthM: 10, medianDistanceM: 30 });
  const high = confidenceScore({ frameCount: 80, sectionLengthM: 150, medianDistanceM: 4, medianHeadingDiff: 5 });
  assert.ok(high > low);
  assert.ok(high <= 1);
});

test('classify insufficient evidence for short sections', () => {
  const r = classifySection({ frameCount: 3, sectionLengthM: 10, medianDistanceM: 5, medianHeadingDiff: 5 });
  assert.equal(r.classification, 'insufficient_evidence');
});

test('build comparison is deterministic and non-mutating', () => {
  if (!fs.existsSync(RAW_SAMPLE_PATH)) return;
  const fixture = createIsolatedMapsReadFixture();
  try {
    const osmPath = localAreaGeojsonPath('bukit-bintang-imbi');
    const beforeOsm = crypto.createHash('sha256').update(fs.readFileSync(osmPath)).digest('hex');
    const beforeRaw = crypto.createHash('sha256').update(fs.readFileSync(RAW_SAMPLE_PATH)).digest('hex');
    prepareUpdatePreviewFromRaw({ ...fixture.previewPaths, force: true, expected: PAGE1_EXPECTED });
    const outDir = fixture.comparisonOutputDir;
    let a;
    let b;
    withIsolatedMapsReadRoot(fixture, () => {
      a = buildObservationOsmComparison({
        previewPath: fixture.previewPaths.previewPath,
        outputDir: outDir,
      });
      b = buildObservationOsmComparison({
        previewPath: fixture.previewPaths.previewPath,
        outputDir: outDir,
      });
    });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(osmPath)).digest('hex'), beforeOsm);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(RAW_SAMPLE_PATH)).digest('hex'), beforeRaw);
    const summary = JSON.parse(fs.readFileSync(comparisonSummaryPath(outDir), 'utf8'));
    assert.equal(summary.partial_page_scope, 'maps-read-page-1-truncated');
    const sections = JSON.parse(fs.readFileSync(roadSectionsPath(outDir), 'utf8'));
    assert.ok(sections.features.length > 0);
  } finally {
    cleanupIsolatedMapsReadFixture(fixture);
  }
});

test('proposal decision isolation for actionable only', () => {
  if (!fs.existsSync(roadSectionsPath())) return;
  const features = JSON.parse(fs.readFileSync(roadSectionsPath(), 'utf8')).features;
  const f = features.find((x) => x.properties.classification?.startsWith('possible_'));
  if (!f) return;
  const id = f.properties.proposal_id;
  applyProposalDecision({
    proposalId: id,
    newState: 'accepted',
    geometryHash: f.properties.geometry_hash,
    osmBaselineHash: 'abc',
  });
  const store = loadProposalDecisions();
  assert.equal(store.decisions[id].state, 'accepted');
});

test('comparison API manifest has no MAPS_READ_TOKEN', async () => {
  process.env.PINTAZ_TEST = '1';
  const { app } = await import('../src/server.js');
  const http = await import('node:http');
  await new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      http.get(`http://127.0.0.1:${port}/api/comparison/v1/summary`, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          assert.doesNotMatch(text, /MAPS_READ_TOKEN/);
          server.close();
          resolve();
        });
      });
    });
  });
});

test('click priority order in map-selection module', async () => {
  const fsMod = await import('node:fs');
  const text = fsMod.readFileSync('src/public/map-selection.js', 'utf8');
  const idx = text.indexOf('return function handleMapClick');
  const block = text.slice(idx, idx + 2800);
  const candIdx = block.indexOf('tryMismatchCandidateClick');
  const obsIdx = block.indexOf('handleObservationEvidenceClick');
  const mismatchIdx = block.indexOf('tryMismatchNonCandidateClick');
  const propIdx = block.indexOf("group === 'proposed'");
  const roadIdx = block.indexOf('layers: DETAILED_FILL_LAYER_IDS');
  assert.ok(candIdx >= 0 && candIdx < obsIdx && obsIdx < mismatchIdx && mismatchIdx < propIdx && propIdx < roadIdx);
});

test('selected road card markup exists', () => {
  const html = fs.readFileSync('src/public/index.html', 'utf8');
  assert.match(html, /map-selection-card/);
});

test('one-way compatibility rejects opposite travel', () => {
  const seg = { oneway: 'yes', headingDeg: 90 };
  assert.equal(onewayCompatible(seg, 90), true);
  assert.equal(onewayCompatible(seg, 270), false);
});

test('temporal sort orders poses by log_mono_time', () => {
  const poses = sortPoses([
    { properties: { log_mono_time: 3 }, geometry: { type: 'Point', coordinates: [0, 0] } },
    { properties: { log_mono_time: 1 }, geometry: { type: 'Point', coordinates: [0, 0] } },
  ]);
  assert.equal(poses[0].properties.log_mono_time, 1);
});

test('lane attach uses vehicle pose frame', () => {
  const matched = [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [101.71, 3.15] },
      properties: { pose_index: 0, frame_id: 7, osm_id: '1', segment_heading_deg: 90 },
    },
  ];
  const lookup = buildPoseLookup(matched);
  const obs = [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [101.71001, 3.15] },
      properties: { layer: 'lane_point', frame_id: 7 },
    },
  ];
  const { attached } = attachObservationsToPoses(obs, lookup, new Map());
  assert.equal(attached.length, 1);
  assert.equal(attached[0].properties.layer, 'lane_point');
});

test('section grouping splits on OSM change', () => {
  const mk = (osm, lon) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, 3.15] },
    properties: { osm_id: osm, distance_m: 3, heading_diff_deg: 5, highway: 'tertiary', name: 'A' },
  });
  const sections = groupMatchedPosesIntoSections([mk('1', 101.71), mk('2', 101.72)], [], []);
  assert.equal(sections.length, 2);
});

test('proposal display gate requires support', () => {
  assert.equal(
    proposalPassesDisplayGate({
      properties: { classification: 'alignment_consistent', confidence: 0.6, vehicle_frames: 20, section_length_m: 50 },
    }),
    true
  );
  assert.equal(
    proposalPassesDisplayGate({
      properties: { classification: 'ambiguous_parallel_road', confidence: 0.9, vehicle_frames: 50, section_length_m: 100 },
    }),
    false
  );
});

test('verified sections cannot be accepted via API', async () => {
  if (!fs.existsSync(roadSectionsPath())) return;
  process.env.PINTAZ_TEST = '1';
  const { app } = await import('../src/server.js');
  const http = await import('node:http');
  await new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const body = JSON.stringify({ proposal_id: 'c9e892692026fd9c', state: 'accepted' });
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/comparison/v1/proposal/decision',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
        },
        (res) => {
          res.resume();
          res.on('end', () => {
            assert.equal(res.statusCode, 400);
            server.close();
            resolve();
          });
        }
      );
      req.write(body);
      req.end();
    });
  });
});

test('parameter sensitivity documents all radii', () => {
  if (!fs.existsSync(comparisonSensitivityPath())) return;
  const s = JSON.parse(fs.readFileSync(comparisonSensitivityPath(), 'utf8'));
  for (const r of ['5', '10', '15', '25']) assert.ok(s[r]);
});

test('proposal sections geojson is valid FeatureCollection', () => {
  if (!fs.existsSync(roadSectionsPath())) return;
  const g = JSON.parse(fs.readFileSync(roadSectionsPath(), 'utf8'));
  assert.equal(g.type, 'FeatureCollection');
  for (const f of g.features) {
    assert.equal(f.type, 'Feature');
    assert.ok(f.properties.proposal_id);
    assert.ok(!String(f.properties.proposal_id).includes('---'));
  }
});

test('invalid proposal state rejected', () => {
  assert.throws(() =>
    applyProposalDecision({ proposalId: 'x', newState: 'bogus', geometryHash: 'a', osmBaselineHash: 'b' })
  );
});

test('responsive bottom sheet at narrow width', () => {
  const css = fs.readFileSync('src/public/style.css', 'utf8');
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /\.map-selection-card/);
});

test('OSM hash unchanged after proposal decision', () => {
  if (!fs.existsSync(roadSectionsPath())) return;
  const osmPath = localAreaGeojsonPath('bukit-bintang-imbi');
  const before = crypto.createHash('sha256').update(fs.readFileSync(osmPath)).digest('hex');
  const f = JSON.parse(fs.readFileSync(roadSectionsPath(), 'utf8')).features.find((x) => x.properties.proposal_eligible);
  if (f) {
    applyProposalDecision({
      proposalId: f.properties.proposal_id,
      newState: 'rejected',
      geometryHash: f.properties.geometry_hash,
      osmBaselineHash: 'test',
    });
  }
  const after = crypto.createHash('sha256').update(fs.readFileSync(osmPath)).digest('hex');
  assert.equal(before, after);
});

test('raw sample hash unchanged after comparison build', () => {
  if (!fs.existsSync(RAW_SAMPLE_PATH)) return;
  const fixture = createIsolatedMapsReadFixture();
  try {
    const before = crypto.createHash('sha256').update(fs.readFileSync(RAW_SAMPLE_PATH)).digest('hex');
    prepareUpdatePreviewFromRaw({ ...fixture.previewPaths, force: true, expected: PAGE1_EXPECTED });
    withIsolatedMapsReadRoot(fixture, () =>
      buildObservationOsmComparison({
        previewPath: fixture.previewPaths.previewPath,
        outputDir: fixture.comparisonOutputDir,
      })
    );
    const after = crypto.createHash('sha256').update(fs.readFileSync(RAW_SAMPLE_PATH)).digest('hex');
    assert.equal(before, after);
  } finally {
    cleanupIsolatedMapsReadFixture(fixture);
  }
});

test('comparison sections API redacts secrets', async () => {
  if (!fs.existsSync(roadSectionsPath())) return;
  process.env.PINTAZ_TEST = '1';
  const { app } = await import('../src/server.js');
  const http = await import('node:http');
  await new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      http.get(`http://127.0.0.1:${port}/api/comparison/v1/sections/geojson`, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          assert.doesNotMatch(text, /MAPS_READ_TOKEN/);
          assert.doesNotMatch(text, /0367014303470e14/);
          server.close();
          resolve();
        });
      });
    });
  });
});

test('proposal card markup and reset control', () => {
  const html = fs.readFileSync('src/public/index.html', 'utf8');
  assert.match(html, /comparison-reset-proposals/);
  assert.match(html, /map-selection-card-title/);
});

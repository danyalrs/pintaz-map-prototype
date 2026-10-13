import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  comparisonUiGroup,
  isActionableProposal,
  computeUiSummaryFromFeatures,
  enrichSectionProperties,
  VERIFIED_CLASSIFICATION,
} from '../src/lib/comparison-ui-groups.js';
import {
  boundsForFeatures,
  COMPARISON_FIT_PADDING,
  lineStringBounds,
} from '../src/lib/comparison-fit-bounds.js';
import { NOT_ACTIONABLE_MSG } from '../src/lib/comparison-routes.js';
import { roadSectionsPath } from '../src/lib/comparison-paths.js';
import { localAreaGeojsonPath } from '../src/lib/local-areas.js';
import { RAW_SAMPLE_PATH } from '../src/lib/update-preview-paths.js';

test('alignment_consistent maps to verified ui group', () => {
  assert.equal(comparisonUiGroup('alignment_consistent'), 'verified');
  assert.equal(comparisonUiGroup(VERIFIED_CLASSIFICATION), 'verified');
});

test('verified sections do not count as actionable proposals', () => {
  assert.equal(isActionableProposal('alignment_consistent'), false);
  const enriched = enrichSectionProperties({ classification: 'alignment_consistent' });
  assert.equal(enriched.ui_group, 'verified');
  assert.equal(enriched.ui_actionable, false);
});

test('possible classifications remain actionable', () => {
  for (const c of [
    'possible_centerline_offset',
    'possible_lane_geometry_difference',
    'possible_missing_osm_road',
  ]) {
    assert.equal(isActionableProposal(c), true);
    assert.equal(comparisonUiGroup(c), 'proposed');
  }
});

test('ambiguous and insufficient are non-actionable diagnostics', () => {
  for (const c of [
    'ambiguous_parallel_road',
    'ambiguous_junction_or_flyover',
    'insufficient_evidence',
  ]) {
    assert.equal(isActionableProposal(c), false);
    assert.equal(comparisonUiGroup(c), 'diagnostic');
  }
});

test('summary counts derive from comparison output file', () => {
  if (!fs.existsSync(roadSectionsPath())) return;
  const geo = JSON.parse(fs.readFileSync(roadSectionsPath(), 'utf8'));
  const counts = computeUiSummaryFromFeatures(geo.features);
  assert.equal(counts.verified, 1);
  assert.equal(counts.proposed, 0);
  assert.equal(counts.ambiguous, 0);
  assert.equal(counts.insufficient_evidence, 22);
});

test('road comparison controls exist in index', () => {
  const html = fs.readFileSync('src/public/index.html', 'utf8');
  assert.match(html, /Road comparison/);
  assert.match(html, /comparison-sections-toggle/);
  assert.match(html, /comparison-zoom-verified/);
  assert.match(html, /comparison-show-ambiguous/);
  assert.match(html, /comparison-show-insufficient/);
  assert.match(html, /No proposed map changes in this sample/);
});

test('advanced diagnostic toggles off by default in markup', () => {
  const html = fs.readFileSync('src/public/index.html', 'utf8');
  assert.match(html, /id="comparison-show-ambiguous"[^>]*\/>/);
  assert.doesNotMatch(html, /id="comparison-show-ambiguous"[^>]*checked/);
});

test('zoom derives bounds from geometry', () => {
  const feats = [
    {
      properties: { ui_group: 'verified' },
      geometry: { type: 'LineString', coordinates: [[101.71, 3.14], [101.72, 3.15]] },
    },
  ];
  const b = boundsForFeatures(feats, { uiGroup: 'verified' });
  assert.ok(b);
  assert.ok(lineStringBounds([[101.71, 3.14], [101.72, 3.15]]));
});

test('fit padding accounts for sidebar and card', () => {
  assert.ok(COMPARISON_FIT_PADDING.left >= 280);
  assert.ok(COMPARISON_FIT_PADDING.right >= 300);
});

test('verified hit layer is wider than visible line', () => {
  const src = fs.readFileSync('src/public/map-selection.js', 'utf8');
  assert.match(src, /COMPARISON_HIT_WIDTH = 18/);
  assert.match(src, /LAYER\.verifiedLine[\s\S]*'line-width': 6/);
});

test('verified card has no Accept or Reject', () => {
  const src = fs.readFileSync('src/public/map-selection.js', 'utf8');
  const block = src.slice(src.indexOf('function formatVerifiedHtml'), src.indexOf('function formatProposedHtml'));
  assert.doesNotMatch(block, /proposal-accept-btn/);
  assert.match(src.slice(src.indexOf('function formatProposedHtml')), /proposal-accept-btn/);
});

test('click priority: mismatch candidate, observation, diagnostics, then comparison', () => {
  const src = fs.readFileSync('src/public/map-selection.js', 'utf8');
  const idx = src.indexOf('return function handleMapClick');
  const block = src.slice(idx, idx + 3500);
  const cand = block.indexOf('tryMismatchCandidateClick');
  const obs = block.indexOf('handleObservationEvidenceClick');
  const mismatchDiag = block.indexOf('tryMismatchNonCandidateClick');
  const prop = block.indexOf("group === 'proposed'");
  const ver = block.indexOf("group === 'verified'");
  const compDiag = block.indexOf("group === 'diagnostic'");
  const road = block.indexOf('DETAILED_FILL_LAYER_IDS');
  assert.ok(cand < obs && obs < mismatchDiag && mismatchDiag < prop);
  assert.ok(prop < ver && ver < compDiag && compDiag < road);
});

test('kinrara clears comparison via loadComparisonForArea', () => {
  const html = fs.readFileSync('src/public/index.html', 'utf8');
  const src = fs.readFileSync('src/public/map-selection.js', 'utf8');
  assert.match(html, /No comparison data for this area/);
  assert.match(src, /areaId !== COMPARISON_AREA/);
});

test('comparison layers use single source id', () => {
  const src = fs.readFileSync('src/public/map-selection.js', 'utf8');
  const addSourceCount = (src.match(/addSource\(COMPARISON_SOURCE_ID/g) || []).length;
  assert.equal(addSourceCount, 1);
  assert.match(src, /pintaz-comparison-verified-line/);
});

test('API rejects verified section decision', async () => {
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
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            assert.equal(res.statusCode, 400);
            const text = Buffer.concat(chunks).toString();
            assert.match(text, new RegExp(NOT_ACTIONABLE_MSG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
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

test('OSM and raw hashes unchanged', () => {
  const osmPath = localAreaGeojsonPath('bukit-bintang-imbi');
  const beforeOsm = crypto.createHash('sha256').update(fs.readFileSync(osmPath)).digest('hex');
  const beforeRaw = crypto.createHash('sha256').update(fs.readFileSync(RAW_SAMPLE_PATH)).digest('hex');
  assert.equal(beforeOsm, 'ea577ccf4f4a2e917e5814a515802539674316cc30f9ed9700aed2e366456111');
  assert.equal(beforeRaw, 'f5c96176bc9f528ba53e3e25d407396c300593e71d73111e8e1e9316f6b8e826');
});

test('comparison summary API has ui counts not tokens', async () => {
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
          const json = JSON.parse(text);
          assert.equal(json.manifest.verified_count, 1);
          assert.equal(json.manifest.proposed_change_count, 0);
          server.close();
          resolve();
        });
      });
    });
  });
});

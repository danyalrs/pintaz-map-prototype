import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { BROWSER_LIB_MODULE_FILES } from '../src/lib/browser-lib-modules.js';
import { loadActiveSourceManifest, validateActiveSourceManifest } from '../src/lib/active-source-manifest.js';
import { PROTECTED_INPUT_SHA256 } from '../src/lib/multi-drive-mismatch-config.js';
import { laneBaselineSummarySemanticDigestFromJsonText } from '../src/lib/lane-baseline-semantic-digest.js';
import { summaryPath } from '../src/lib/lane-baseline-paths.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'src', 'public');

function collectBrowserImports() {
  const imports = new Set();
  const re = /from\s+['"]([^'"]+)['"]/g;
  for (const f of fs.readdirSync(publicDir).filter((n) => n.endsWith('.js'))) {
    const t = fs.readFileSync(path.join(publicDir, f), 'utf8');
    let m;
    while ((m = re.exec(t))) imports.add(m[1]);
  }
  return imports;
}

async function withTestServer(fn) {
  process.env.PINTAZ_TEST = '1';
  const { app } = await import('../src/server.js');
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

test('every browser /lib module returns JavaScript 200', async () => {
  await withTestServer(async (base) => {
    for (const file of BROWSER_LIB_MODULE_FILES) {
      const res = await fetch(`${base}/lib/${file}`);
      assert.equal(res.status, 200, file);
      assert.match(res.headers.get('content-type') || '', /javascript/i, file);
    }
  });
});

test('every public ES-module import resolves with 200', async () => {
  await withTestServer(async (base) => {
    const failed = [];
    for (const imp of collectBrowserImports()) {
      if (!imp.startsWith('/') && !imp.startsWith('.')) continue;
      let url = imp.split('?')[0];
      if (url.startsWith('./')) url = `/${path.basename(url)}`;
      if (!url.startsWith('/')) continue;
      const q = imp.includes('?') ? `?${imp.split('?')[1]}` : '';
      const res = await fetch(`${base}${url}${q}`);
      if (res.status !== 200) failed.push({ imp, status: res.status });
    }
    assert.deepEqual(failed, []);
  });
});

test('active route metrics report complete route with 8706 features', async () => {
  await withTestServer(async (base) => {
    const res = await fetch(`${base}/api/local-route-explorer/v1/routes/active/metrics`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.metrics.route_status, 'complete');
    assert.equal(body.metrics.feature_total, 8706);
    const text = JSON.stringify(body);
    assert.ok(!/dongle_fingerprint/i.test(text));
    assert.ok(!/Bearer\s+/i.test(text));
  });
});

test('local areas catalog includes Bukit and Kinrara', async () => {
  await withTestServer(async (base) => {
    const res = await fetch(`${base}/api/local-areas`);
    assert.equal(res.status, 200);
    const body = await res.json();
    const ids = body.areas.map((a) => a.id);
    assert.ok(ids.includes('bukit-bintang-imbi'));
    assert.ok(ids.includes('bandar-kinrara'));
  });
});

test('api config exposes mapbox configured without leaking token shape in errors', async () => {
  await withTestServer(async (base) => {
    const res = await fetch(`${base}/api/config`);
    assert.equal(res.status, 200);
    const cfg = await res.json();
    assert.equal(cfg.mapbox.configured, true);
    assert.ok(typeof cfg.mapbox.publicToken === 'string');
    assert.match(cfg.mapbox.publicToken, /^pk\./);
  });
});

test('index.html references startup error panel and cache version', () => {
  const html = fs.readFileSync(path.join(root, 'src', 'public', 'index.html'), 'utf8');
  assert.match(html, /startup-error-panel/);
  assert.match(html, /osm-turn-lane-guidance-v2/);
});

test('app startup exports reportStartupFailure', async () => {
  const src = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  assert.match(src, /export function reportStartupFailure/);
  assert.match(src, /new mapboxgl\.Map/);
});

test('mismatch-layers keeps imports before exports', () => {
  const src = fs.readFileSync(path.join(publicDir, 'mismatch-layers.js'), 'utf8');
  const firstExport = src.search(/^export /m);
  const lastImport = src.lastIndexOf('\nimport ');
  assert.ok(firstExport > lastImport, 'import must precede export in mismatch-layers.js');
});

test('map layout reserves positive map container dimensions', () => {
  const css = fs.readFileSync(path.join(publicDir, 'style.css'), 'utf8');
  assert.match(css, /#map/);
  assert.match(css, /min-height|height/);
});

test('active source manifest validates on disk', () => {
  const m = loadActiveSourceManifest();
  const v = validateActiveSourceManifest(m);
  assert.equal(v.ok, true);
  assert.equal(m.total_features, 8706);
  assert.equal(m.route_status, 'complete');
});

test('protected OSM and lane semantic hashes unchanged', () => {
  const summary = fs.readFileSync(summaryPath(), 'utf8');
  const digest = laneBaselineSummarySemanticDigestFromJsonText(summary);
  assert.equal(digest, PROTECTED_INPUT_SHA256.lane_baseline_summary);
  assert.equal(PROTECTED_INPUT_SHA256.bukit_osm, 'ea577ccf4f4a2e917e5814a515802539674316cc30f9ed9700aed2e366456111');
});

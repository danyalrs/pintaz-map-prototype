import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  HOST,
  PORT,
  loadMapboxTokenFromEnv,
  TILES,
  REGION_BOUNDS,
  MAPBOX_STYLE,
  ROOT_DIR,
} from './config.js';
import {
  datasetMetaPath,
  extractionMetaPath,
  downloadRecordPath,
  mapConfigPath,
  roadStylesPath,
  pilotAreaConfigPath,
  localAreaBandarKinraraMetaPath,
} from './lib/paths.js';
import {
  DEFAULT_LOCAL_AREA_ID,
  listPublicLocalAreas,
  localAreaGeojsonPath,
  localAreaMetaPath,
  normalizeAreaId,
  isConfiguredAreaId,
} from './lib/local-areas.js';
import { loadPilotAreaConfig, validateBounds, paddedBounds } from './lib/pilot-area.js';
import { readTileFile } from './lib/tile-files.js';
import { readMbtilesTile, mbtilesExists } from './lib/mbtiles-reader.js';
import { parseTileParams } from './lib/tile-coords.js';
import { countTileFiles, tilesDiskSizeBytes, tileFormatLabel } from './lib/tile-files.js';
import { prepareVectorTileResponse } from './lib/tile-encoding.js';
import { registerComparisonRoutes } from './lib/comparison-routes.js';
import { registerLaneBaselineRoutes } from './lib/lane-baseline-routes.js';
import { registerMismatchRoutes } from './lib/mismatch-routes.js';
import { registerMultiDriveMismatchRoutes } from './lib/multi-drive-routes.js';
import { registerLocalRouteExplorerRoutes } from './lib/local-route-explorer-routes.js';
import { BROWSER_LIB_MODULE_FILES } from './lib/browser-lib-modules.js';

const COVERAGE_DIR = path.join(ROOT_DIR, 'data', 'coverage');
const COVERAGE_REPORT_DIR = path.join(ROOT_DIR, 'reports', 'coverage');

const app = express();
const srcDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(srcDir, 'public');
const browserLibModules = BROWSER_LIB_MODULE_FILES;

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

app.disable('x-powered-by');
function noStoreJs(_req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

for (const fileName of browserLibModules) {
  app.get(`/lib/${fileName}`, noStoreJs, (_req, res) => {
    res.type('application/javascript');
    res.sendFile(path.join(srcDir, 'lib', fileName));
  });
}
app.use(
  express.static(publicDir, {
    maxAge: 0,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.js') || filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store');
      }
    },
  })
);

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'pintaz-map-prototype' });
});

app.get('/api/config', (_req, res) => {
  const { token, error } = loadMapboxTokenFromEnv();
  const mapConfig = readJsonIfExists(mapConfigPath()) || {};
  const roadStyles = readJsonIfExists(roadStylesPath()) || {};
  const pilotArea = loadPilotAreaConfig() || readJsonIfExists(pilotAreaConfigPath());
  const pilotValid = pilotArea ? validateBounds(pilotArea.bounds) : { ok: false };
  res.json({
    mapbox: {
      configured: Boolean(token),
      tokenError: error,
      publicToken: token,
      style: MAPBOX_STYLE,
    },
    region: {
      bounds: REGION_BOUNDS,
      view: mapConfig.regionView || { center: [110, 4], zoom: 5 },
      label: 'Full Geofabrik extract (Malaysia · Singapore · Brunei)',
    },
    pilotArea:
      pilotArea && pilotValid.ok
        ? {
            ...pilotArea,
            maxBounds: paddedBounds(pilotArea.bounds, pilotArea.maxBoundsPaddingDegrees ?? 0.035),
          }
        : null,
    tiles: {
      urlTemplate: '/tiles/roads/{z}/{x}/{y}.pbf',
      sourceId: TILES.sourceId,
      layerPrefix: TILES.layerPrefix,
      minZoom: TILES.minZoom,
      maxZoom: TILES.maxZoom,
    },
    futureLayers: ['qlog-observations', 'accepted-updates'],
    roadStyles,
    mapConfig,
    localArea: readJsonIfExists(localAreaBandarKinraraMetaPath()),
    defaultLocalAreaId: DEFAULT_LOCAL_AREA_ID,
  });
});

function sendLocalAreaMeta(areaId, res) {
  const id = normalizeAreaId(areaId);
  if (!id || !isConfiguredAreaId(id)) {
    return res.status(404).json({ error: 'Unknown local area.' });
  }
  const p = localAreaMetaPath(id);
  if (!fs.existsSync(p)) {
    return res.status(404).json({ error: `Local area data missing for ${id}. Run extraction first.` });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.type('json').send(fs.readFileSync(p, 'utf8'));
}

function sendLocalAreaGeojson(areaId, res) {
  const id = normalizeAreaId(areaId);
  if (!id || !isConfiguredAreaId(id)) {
    return res.status(404).json({ error: 'Unknown local area.' });
  }
  const p = localAreaGeojsonPath(id);
  if (!fs.existsSync(p)) {
    return res.status(404).json({ error: 'Local roads GeoJSON not found.' });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.type('application/geo+json').send(fs.readFileSync(p, 'utf8'));
}

app.get('/api/local-areas', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    defaultAreaId: DEFAULT_LOCAL_AREA_ID,
    areas: listPublicLocalAreas(),
  });
});

app.get('/api/local-area/:areaId/meta.json', (req, res) => {
  sendLocalAreaMeta(req.params.areaId, res);
});

app.get('/api/local-area/:areaId/roads.geojson', (req, res) => {
  sendLocalAreaGeojson(req.params.areaId, res);
});

app.get('/api/dataset', (_req, res) => {
  const download = readJsonIfExists(downloadRecordPath());
  const extraction = readJsonIfExists(extractionMetaPath());
  const dataset = readJsonIfExists(datasetMetaPath());
  const tileCount = countTileFiles();
  res.json({
    download,
    extraction,
    dataset,
    tiles: {
      format: tileFormatLabel(),
      path: tileCount > 0 ? 'data/tiles/roads/' : null,
      sizeBytes: tilesDiskSizeBytes(),
      tileCount,
    },
  });
});

app.get('/api/coverage/summary', (_req, res) => {
  const p = path.join(COVERAGE_REPORT_DIR, 'coverage_summary.json');
  if (!fs.existsSync(p)) {
    return res.status(404).json({ error: 'Coverage scan not found. Run npm run scan:coverage.' });
  }
  res.type('json').send(fs.readFileSync(p, 'utf8'));
});

app.get('/api/coverage/components', (_req, res) => {
  const p = path.join(COVERAGE_DIR, 'coverage-components.json');
  if (!fs.existsSync(p)) {
    return res.status(404).json({ error: 'Coverage components not found. Run npm run scan:coverage.' });
  }
  res.type('json').send(fs.readFileSync(p, 'utf8'));
});

app.get('/api/coverage/geojson/:z', (req, res) => {
  const z = Number(req.params.z);
  if (![10, 12, 14].includes(z)) {
    return res.status(400).json({ error: 'Zoom must be 10, 12, or 14' });
  }
  const p = path.join(COVERAGE_DIR, `road-tile-coverage-z${z}.geojson`);
  if (!fs.existsSync(p)) {
    return res.status(404).json({ error: 'Coverage GeoJSON not found for this zoom.' });
  }
  res.type('json').send(fs.readFileSync(p, 'utf8'));
});

registerComparisonRoutes(app);
registerLocalRouteExplorerRoutes(app);
registerLaneBaselineRoutes(app);
registerMismatchRoutes(app);
registerMultiDriveMismatchRoutes(app);

app.get('/api/road-summary', (_req, res) => {
  const extraction = readJsonIfExists(extractionMetaPath());
  if (!extraction) {
    return res.status(404).json({ error: 'Road extraction metadata not found. Run extract:roads first.' });
  }
  res.json({
    totalWays: extraction.totalWays,
    rejected: extraction.rejected,
    byHighway: extraction.byHighway,
    bounds: extraction.bounds,
  });
});

app.get('/tiles/roads/:z/:x/:y.pbf', async (req, res) => {
  const yParam = String(req.params.y).replace(/\.pbf$/i, '');
  const parsed = parseTileParams(req.params.z, req.params.x, yParam);
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error });
  }
  let data = readTileFile(parsed.z, parsed.x, parsed.y);
  if (!data && mbtilesExists()) {
    data = await readMbtilesTile(parsed.z, parsed.x, parsed.y);
  }
  if (!data) {
    return res.status(404).json({ error: 'Tile not found' });
  }
  const { headers, body } = prepareVectorTileResponse(data);
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  res.send(body);
});

app.use((err, _req, res, _next) => {
  console.error(err.message);
  res.status(500).json({ error: 'Internal server error' });
});

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href &&
  !process.env.PINTAZ_TEST;

if (isMain) {
  app.listen(PORT, HOST, () => {
    console.log(`Pintaz Map prototype listening at http://${HOST}:${PORT}`);
  });
}

export { app };

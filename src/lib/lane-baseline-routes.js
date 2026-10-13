import fs from 'node:fs';
import { ensureLaneBaselineBuilt, buildLaneBaselineForArea } from './lane-baseline-build.js';
import {
  LANE_BASELINE_AREA,
  surfacesPath,
  dividersPath,
  directionMarkersPath,
  summaryPath,
  roadIndexPath,
} from './lane-baseline-paths.js';
import { loadObservationCoverageFeature } from './observation-coverage.js';
import { localAreaGeojsonPath } from './local-areas.js';
import { loadTurnLaneGuidanceForArea } from './osm-turn-lane-guidance.js';

export function registerLaneBaselineRoutes(app) {
  try {
    ensureLaneBaselineBuilt(LANE_BASELINE_AREA);
  } catch (e) {
    console.error(`Lane baseline build skipped: ${e.message}`);
  }

  app.get('/api/lane-baseline/v1/:areaId/summary', (req, res) => {
    const areaId = req.params.areaId;
    res.setHeader('Cache-Control', 'no-store');
    const p = summaryPath(areaId);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Not built', area_id: areaId });
    res.json(JSON.parse(fs.readFileSync(p, 'utf8')));
  });

  app.get('/api/lane-baseline/v1/:areaId/surfaces.geojson', (req, res) => {
    const p = surfacesPath(req.params.areaId);
    if (!fs.existsSync(p)) return res.status(404).send('Not found');
    res.type('application/geo+json').send(fs.readFileSync(p, 'utf8'));
  });

  app.get('/api/lane-baseline/v1/:areaId/dividers.geojson', (req, res) => {
    const p = dividersPath(req.params.areaId);
    if (!fs.existsSync(p)) return res.status(404).send('Not found');
    res.type('application/geo+json').send(fs.readFileSync(p, 'utf8'));
  });

  app.get('/api/lane-baseline/v1/:areaId/direction-markers.geojson', (req, res) => {
    const p = directionMarkersPath(req.params.areaId);
    if (!fs.existsSync(p)) return res.status(404).send('Not found');
    res.type('application/geo+json').send(fs.readFileSync(p, 'utf8'));
  });

  app.get('/api/lane-baseline/v1/:areaId/turn-lane-guidance.geojson', (req, res) => {
    const areaId = req.params.areaId;
    res.setHeader('Cache-Control', 'no-store');
    const roadsPath = localAreaGeojsonPath(areaId);
    if (!fs.existsSync(roadsPath)) return res.status(404).send('Not found');
    const roads = JSON.parse(fs.readFileSync(roadsPath, 'utf8'));
    const collection = loadTurnLaneGuidanceForArea(areaId, roads);
    res.type('application/geo+json').send(JSON.stringify(collection));
  });

  app.get('/api/lane-baseline/v1/:areaId/road/:osmId', (req, res) => {
    const p = roadIndexPath(req.params.areaId);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Not found' });
    const idx = JSON.parse(fs.readFileSync(p, 'utf8'));
    const row = idx.by_osm_id?.[req.params.osmId];
    if (!row) return res.status(404).json({ error: 'Road not in index' });
    res.json({ ok: true, derived: row });
  });

  app.get('/api/lane-baseline/v1/observation-coverage.geojson', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const f = loadObservationCoverageFeature();
    if (!f) return res.status(404).json({ error: 'No preview coverage' });
    res.type('application/geo+json').send(JSON.stringify({ type: 'FeatureCollection', features: [f] }));
  });

  app.post('/api/lane-baseline/v1/rebuild', (req, res) => {
    if (process.env.PINTAZ_TEST !== '1' && process.env.ALLOW_LANE_REBUILD !== '1') {
      return res.status(403).json({ error: 'Rebuild disabled' });
    }
    const result = buildLaneBaselineForArea(LANE_BASELINE_AREA);
    res.json(result);
  });
}

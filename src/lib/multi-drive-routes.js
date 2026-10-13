import fs from 'node:fs';
import express from 'express';
import {
  aggregateSummaryRedactedPath,
  aggregateSectionsRedactedPath,
  supportedCandidatesRedactedPath,
  diagnosticsRedactedPath,
  MULTI_DRIVE_AREA_ID,
} from './multi-drive-mismatch-paths.js';
import {
  applyMultiDriveDecision,
  loadMultiDriveDecisions,
  resetMultiDriveDecisions,
} from './multi-drive-decisions.js';
import { assertPublicGeoJsonSafe, assertPublicOutputSafe, isMultiDriveActionable } from './multi-drive-redact.js';

const NOT_ACTIONABLE_MSG = 'This aggregate section is not an actionable multi-drive review candidate.';
const MAX_BODY = 4096;

function strictJsonBody(req, res, next) {
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) {
      res.status(413).json({ error: 'Body too large' });
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    if (res.writableEnded) return;
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) {
      req.body = {};
      return next();
    }
    try {
      req.body = JSON.parse(raw);
    } catch {
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }
    next();
  });
}

function readGeo(path) {
  if (!fs.existsSync(path)) return null;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function enrichCandidates(geo) {
  const decisions = loadMultiDriveDecisions();
  const features = (geo.features || []).map((f) => {
    const id = f.properties?.aggregate_id;
    const decisionState = decisions.decisions[id]?.state || 'pending';
    return {
      ...f,
      properties: {
        ...f.properties,
        candidate_state: decisionState,
        ui_actionable: true,
        ui_group: 'multi_drive_candidate',
      },
    };
  });
  return { ...geo, features };
}

function loadAggregateFeature(aggregateId) {
  const geo = readGeo(aggregateSectionsRedactedPath());
  return geo?.features?.find((f) => f.properties?.aggregate_id === aggregateId);
}

export function registerMultiDriveMismatchRoutes(app) {
  app.get('/api/multi-drive-mismatch/v1/bukit-bintang-imbi/summary', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const p = aggregateSummaryRedactedPath();
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Not built' });
    const summary = JSON.parse(fs.readFileSync(p, 'utf8'));
    assertPublicOutputSafe(summary);
    res.json({ ok: true, manifest: summary });
  });

  app.get('/api/multi-drive-mismatch/v1/bukit-bintang-imbi/sections.geojson', (req, res) => {
    const geo = readGeo(aggregateSectionsRedactedPath());
    if (!geo) return res.status(404).json({ error: 'Not found' });
    res.type('application/geo+json; charset=UTF-8');
    assertPublicGeoJsonSafe(geo);
    res.send(JSON.stringify(geo));
  });

  app.get('/api/multi-drive-mismatch/v1/bukit-bintang-imbi/candidates.geojson', (req, res) => {
    const geo = readGeo(supportedCandidatesRedactedPath());
    if (!geo) return res.status(404).json({ error: 'Not found' });
    res.type('application/geo+json; charset=UTF-8');
    const out = enrichCandidates(geo);
    assertPublicGeoJsonSafe(out);
    res.send(JSON.stringify(out));
  });

  app.get('/api/multi-drive-mismatch/v1/bukit-bintang-imbi/diagnostics.geojson', (req, res) => {
    const geo = readGeo(diagnosticsRedactedPath());
    if (!geo) return res.status(404).json({ error: 'Not found' });
    res.type('application/geo+json; charset=UTF-8');
    assertPublicGeoJsonSafe(geo);
    res.send(JSON.stringify(geo));
  });

  app.post(
    '/api/multi-drive-mismatch/v1/bukit-bintang-imbi/candidate/:id/decision',
    strictJsonBody,
    (req, res) => {
      const keys = Object.keys(req.body || {});
      if (keys.length !== 1 || !keys.includes('state')) {
        return res.status(400).json({ error: 'Body must contain state only' });
      }
      const aggregateId = req.params.id;
      const feature = loadAggregateFeature(aggregateId);
      if (!feature) return res.status(404).json({ error: 'Candidate not found' });
      if (!isMultiDriveActionable(feature.properties?.aggregate_state)) {
        return res.status(400).json({ error: NOT_ACTIONABLE_MSG });
      }
      try {
        applyMultiDriveDecision({
          candidateId: aggregateId,
          newState: req.body.state,
          aggregateState: feature.properties?.aggregate_state,
        });
        res.json({ ok: true, aggregate_id: aggregateId, state: req.body.state });
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    }
  );

  app.post('/api/multi-drive-mismatch/v1/bukit-bintang-imbi/reset', strictJsonBody, (req, res) => {
    if (Object.keys(req.body || {}).length) {
      return res.status(400).json({ error: 'Body must be empty object' });
    }
    resetMultiDriveDecisions();
    res.json({ ok: true });
  });
}

export { NOT_ACTIONABLE_MSG, MULTI_DRIVE_AREA_ID };

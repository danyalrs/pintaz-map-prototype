import fs from 'node:fs';
import express from 'express';
import { buildOsmServerMismatchV1, ensureMismatchBuilt } from './mismatch-build.js';
import {
  mismatchSummaryPath,
  sectionResultsPath,
  actionableCandidatesPath,
  diagnosticSectionsPath,
  MISMATCH_AREA_ID,
} from './mismatch-paths.js';
import {
  applyMismatchDecision,
  loadMismatchDecisions,
  resetMismatchDecisions,
  cleanupInvalidMismatchDecisions,
} from './mismatch-decisions.js';
import {
  enrichMismatchProperties,
  computeMismatchUiCounts,
  isActionableMismatch,
} from './mismatch-ui-groups.js';
import { localAreaGeojsonPath } from './local-areas.js';
import { createHash } from 'node:crypto';

const NOT_ACTIONABLE_MSG = 'This mismatch section is not an actionable review candidate.';
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

function loadSections() {
  const p = sectionResultsPath();
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function sectionHash(feature) {
  return createHash('sha256').update(JSON.stringify(feature.geometry)).digest('hex');
}

function osmHashForId(osmId) {
  const roads = JSON.parse(fs.readFileSync(localAreaGeojsonPath(MISMATCH_AREA_ID), 'utf8'));
  const f = roads.features.find((x) => String(x.properties?.osm_id) === String(osmId));
  if (!f) return null;
  return createHash('sha256').update(JSON.stringify(f.geometry)).digest('hex');
}

function enrichGeojson(geo) {
  const decisions = loadMismatchDecisions();
  const features = geo.features.map((f) => {
    const id = f.properties?.candidate_id;
    const decisionState =
      isActionableMismatch(f.properties?.classification) && decisions.decisions[id]
        ? decisions.decisions[id].state
        : null;
    return { ...f, properties: enrichMismatchProperties(f.properties, decisionState) };
  });
  return { ...geo, features };
}

function safeManifest(summary, uiCounts) {
  if (!summary) return null;
  return {
    area_id: summary.area_id,
    partial_corridor_scope: summary.partial_corridor_scope,
    section_count: summary.section_count,
    classification_counts: summary.classification_counts,
    actionable_candidate_count: summary.actionable_candidate_count,
    section_grouping: summary.section_grouping,
    geometry_eligibility: summary.geometry_eligibility,
    eligibility: summary.eligibility,
    eligibility_tiers: summary.eligibility_tiers,
    support_distributions: summary.support_distributions,
    ui_counts: uiCounts,
    input_hash_prefixes: {
      bukit: String(summary.input_hashes?.bukit_osm_geojson_sha256 || '').slice(0, 12),
      raw: String(summary.input_hashes?.raw_preview_sha256 || '').slice(0, 12),
    },
    osm_width_tag_present: summary.osm_width_tag_present,
  };
}

export function registerMismatchRoutes(app) {
  try {
    ensureMismatchBuilt();
  } catch (e) {
    console.error(`Mismatch build skipped: ${e.message}`);
  }

  const initial = loadSections();
  if (initial?.features?.length) cleanupInvalidMismatchDecisions(initial.features);

  app.get('/api/mismatch/v1/:areaId/summary', (req, res) => {
    if (req.params.areaId !== MISMATCH_AREA_ID) {
      return res.status(404).json({ error: 'No mismatch analysis for this area' });
    }
    res.setHeader('Cache-Control', 'no-store');
    const p = mismatchSummaryPath();
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Not built' });
    const summary = JSON.parse(fs.readFileSync(p, 'utf8'));
    const geo = loadSections();
    const uiCounts = geo ? computeMismatchUiCounts(geo.features) : null;
    res.json({ ok: true, manifest: safeManifest(summary, uiCounts) });
  });

  app.get('/api/mismatch/v1/:areaId/sections.geojson', (req, res) => {
    if (req.params.areaId !== MISMATCH_AREA_ID) return res.status(404).json({ error: 'Not found' });
    const geo = loadSections();
    if (!geo) return res.status(404).json({ error: 'Not found' });
    res.type('application/geo+json; charset=UTF-8');
    res.send(JSON.stringify(enrichGeojson(geo)));
  });

  app.get('/api/mismatch/v1/:areaId/candidates.geojson', (req, res) => {
    if (req.params.areaId !== MISMATCH_AREA_ID) return res.status(404).json({ error: 'Not found' });
    const p = actionableCandidatesPath();
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Not found' });
    const geo = JSON.parse(fs.readFileSync(p, 'utf8'));
    res.type('application/geo+json; charset=UTF-8');
    res.send(JSON.stringify(enrichGeojson(geo)));
  });

  app.get('/api/mismatch/v1/:areaId/diagnostics.geojson', (req, res) => {
    if (req.params.areaId !== MISMATCH_AREA_ID) return res.status(404).json({ error: 'Not found' });
    const p = diagnosticSectionsPath();
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Not found' });
    const geo = JSON.parse(fs.readFileSync(p, 'utf8'));
    res.type('application/geo+json; charset=UTF-8');
    res.send(JSON.stringify(enrichGeojson(geo)));
  });

  app.post('/api/mismatch/v1/:areaId/candidate/:candidateId/decision', strictJsonBody, (req, res) => {
    if (req.params.areaId !== MISMATCH_AREA_ID) {
      return res.status(404).json({ error: 'No mismatch analysis for this area' });
    }
    const keys = Object.keys(req.body || {});
    if (keys.length !== 1 || !keys.includes('state')) {
      return res.status(400).json({ error: 'Body must contain state only' });
    }
    const { state } = req.body;
    const candidateId = req.params.candidateId;
    const geo = loadSections();
    const feature = geo?.features?.find((f) => f.properties?.candidate_id === candidateId);
    if (!feature) return res.status(404).json({ error: 'Candidate not found' });
    if (!isActionableMismatch(feature.properties?.classification)) {
      return res.status(400).json({ error: NOT_ACTIONABLE_MSG });
    }
    try {
      applyMismatchDecision({
        candidateId,
        newState: state,
        sectionHash: sectionHash(feature),
        osmBaselineHash: osmHashForId(feature.properties.osm_id),
      });
      res.json({ ok: true, candidate_id: candidateId, state });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/mismatch/v1/:areaId/reset', strictJsonBody, (req, res) => {
    if (req.params.areaId !== MISMATCH_AREA_ID) {
      return res.status(404).json({ error: 'No mismatch analysis for this area' });
    }
    if (Object.keys(req.body || {}).length) {
      return res.status(400).json({ error: 'Body must be empty object' });
    }
    resetMismatchDecisions();
    res.json({ ok: true });
  });
}

export { NOT_ACTIONABLE_MSG };

import fs from 'node:fs';
import express from 'express';
import { buildObservationOsmComparison, ensureComparisonBuilt } from './comparison-build.js';
import {
  comparisonSummaryPath,
  roadSectionsPath,
  COMPARISON_AREA_ID,
} from './comparison-paths.js';
import {
  applyProposalDecision,
  loadProposalDecisions,
  resetAllProposalDecisions,
  osmFeatureHashFromProps,
  cleanupInvalidProposalDecisions,
} from './comparison-decisions.js';
import {
  enrichSectionProperties,
  computeUiSummaryFromFeatures,
  isActionableProposal,
} from './comparison-ui-groups.js';
import { localAreaGeojsonPath } from './local-areas.js';

const MAX_BODY = 4096;
const NOT_ACTIONABLE_MSG = 'This comparison section is not an actionable map proposal.';

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

function loadSectionsGeojson() {
  const p = roadSectionsPath();
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function enrichGeojsonForApi(geo) {
  const decisions = loadProposalDecisions();
  for (const f of geo.features) {
    const id = f.properties?.proposal_id;
    const decisionState =
      isActionableProposal(f.properties?.classification) && decisions.decisions[id]
        ? decisions.decisions[id].state
        : null;
    f.properties = enrichSectionProperties(f.properties, decisionState);
  }
  return geo;
}

function safeManifest(summary, uiSummary, decisions) {
  if (!summary) return null;
  const actionableDecisionCount = Object.entries(decisions.decisions || {}).filter(([id]) => {
    const geo = loadSectionsGeojson();
    const f = geo?.features?.find((x) => x.properties?.proposal_id === id);
    return f && isActionableProposal(f.properties?.classification);
  }).length;
  return {
    area_id: summary.area_id,
    partial_page_scope: summary.partial_page_scope,
    selected_search_radius_m: summary.selected_search_radius_m,
    matched_pose_count: summary.matched_pose_count,
    rejected_pose_count: summary.rejected_pose_count,
    section_count: summary.section_count,
    classification_counts: summary.classification_counts,
    ui_summary: uiSummary,
    verified_count: uiSummary?.verified ?? 0,
    proposed_change_count: uiSummary?.proposed ?? 0,
    ambiguous_count: uiSummary?.ambiguous ?? 0,
    insufficient_evidence_count: uiSummary?.insufficient_evidence ?? 0,
    osm_baseline_hash_prefix: String(summary.osm_baseline_hash_sha256 || '').slice(0, 12),
    actionable_decision_count: actionableDecisionCount,
  };
}

export function registerComparisonRoutes(app) {
  try {
    ensureComparisonBuilt();
  } catch (e) {
    console.error(`Comparison build skipped: ${e.message}`);
  }

  const initial = loadSectionsGeojson();
  if (initial?.features?.length) {
    cleanupInvalidProposalDecisions(initial.features);
  }

  app.get('/api/comparison/v1/summary', (req, res) => {
    if (req.query.path) return res.status(400).json({ error: 'Invalid query' });
    res.setHeader('Cache-Control', 'no-store');
    const p = comparisonSummaryPath();
    if (!fs.existsSync(p)) {
      return res.status(404).json({ error: 'Comparison not built' });
    }
    const summary = JSON.parse(fs.readFileSync(p, 'utf8'));
    const geo = loadSectionsGeojson();
    const uiSummary = geo ? computeUiSummaryFromFeatures(geo.features) : null;
    const decisions = loadProposalDecisions();
    res.json({ ok: true, manifest: safeManifest(summary, uiSummary, decisions) });
  });

  app.get('/api/comparison/v1/sections/geojson', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const geo = loadSectionsGeojson();
    if (!geo) return res.status(404).json({ error: 'Not found' });
    const enriched = enrichGeojsonForApi({ ...geo, features: geo.features.map((f) => ({ ...f })) });
    res.type('application/geo+json; charset=UTF-8');
    res.send(JSON.stringify(enriched));
  });

  app.post('/api/comparison/v1/proposal/decision', strictJsonBody, (req, res) => {
    const keys = Object.keys(req.body || {});
    if (keys.length !== 2 || !keys.includes('proposal_id') || !keys.includes('state')) {
      return res.status(400).json({ error: 'Body must contain proposal_id and state only' });
    }
    const { proposal_id: proposalId, state } = req.body;
    if (!proposalId || typeof proposalId !== 'string' || proposalId.length > 64) {
      return res.status(400).json({ error: 'Invalid proposal_id' });
    }
    const sections = loadSectionsGeojson() || { features: [] };
    const feature = sections.features.find((f) => f.properties?.proposal_id === proposalId);
    if (!feature) return res.status(404).json({ error: 'Proposal not found' });
    if (!isActionableProposal(feature.properties?.classification)) {
      return res.status(400).json({ error: NOT_ACTIONABLE_MSG });
    }
    const roads = JSON.parse(fs.readFileSync(localAreaGeojsonPath(COMPARISON_AREA_ID), 'utf8'));
    const osmHash = osmFeatureHashFromProps(feature.properties.osm_id, roads);
    try {
      applyProposalDecision({
        proposalId,
        newState: state,
        geometryHash: feature.properties.geometry_hash,
        osmBaselineHash: osmHash,
      });
      res.json({ ok: true, proposal_id: proposalId, state });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/comparison/v1/proposals/reset', strictJsonBody, (req, res) => {
    if (Object.keys(req.body || {}).length) {
      return res.status(400).json({ error: 'Body must be empty object' });
    }
    resetAllProposalDecisions();
    res.json({ ok: true });
  });
}

export { NOT_ACTIONABLE_MSG };

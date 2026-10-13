import fs from 'node:fs';
import express from 'express';
import {
  isAllowedObservationRouteKey,
  OBSERVATION_ROUTES,
  observationRouteSpec,
} from './local-route-explorer/config.js';
import { bootstrapLocalRouteExplorer, ensureDerivedPreviewGeojson } from './local-route-explorer/bootstrap.js';
import { buildRouteMetricsRedacted, buildAllRouteMetricsRedacted } from './local-route-explorer/metrics.js';
import {
  routeComparisonDir,
  comparisonSummaryPath,
  roadSectionsPath,
} from './local-route-explorer/paths.js';
import {
  computeUiSummaryFromFeatures,
  enrichSectionProperties,
  isActionableProposal,
} from './comparison-ui-groups.js';
import { loadProposalDecisions } from './comparison-decisions.js';
import {
  lookupSelectedRouteOsmComparison,
  normalizeOsmWayId,
} from './selected-route-osm-comparison-lookup.js';

function safeComparisonManifest(summary, uiSummary, routeKey) {
  if (!summary) return null;
  const decisions = routeKey === 'active' ? loadProposalDecisions() : { decisions: {} };
  const actionableDecisionCount =
    routeKey === 'active'
      ? Object.keys(decisions.decisions || {}).length
      : 0;
  return {
    area_id: summary.area_id,
    observation_route_key: routeKey,
    diagnostic_only: routeKey !== 'active',
    cross_drive_confirmation: false,
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

function enrichSectionsForRoute(geo, routeKey) {
  const decisions = routeKey === 'active' ? loadProposalDecisions() : { decisions: {} };
  for (const f of geo.features) {
    const id = f.properties?.proposal_id;
    const decisionState =
      routeKey === 'active' && isActionableProposal(f.properties?.classification) && decisions.decisions[id]
        ? decisions.decisions[id].state
        : routeKey === 'active'
          ? null
          : 'diagnostic_read_only';
    f.properties = enrichSectionProperties(f.properties, decisionState);
    if (routeKey !== 'active') {
      f.properties.ui_actionable = false;
      f.properties.diagnostic_observation_route = routeKey;
    }
  }
  return geo;
}

export function registerLocalRouteExplorerRoutes(app) {
  try {
    bootstrapLocalRouteExplorer();
  } catch (e) {
    console.error(`Local route explorer bootstrap: ${e.message}`);
  }

  app.get('/api/local-route-explorer/v1/routes', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      schema: 'pintaz.local-route-explorer.catalog.v1',
      default_route_key: 'active',
      routes: OBSERVATION_ROUTES.map((r) => ({
        route_key: r.route_key,
        option_label: r.option_label,
        role: r.role,
        diagnostic_only: r.route_key !== 'active',
        inventory_tags: r.inventory_tags,
      })),
    });
  });

  app.get('/api/local-route-explorer/v1/routes/:routeKey/metrics', (req, res) => {
    const routeKey = req.params.routeKey;
    if (!isAllowedObservationRouteKey(routeKey)) {
      return res.status(404).json({ error: 'Unknown observation route' });
    }
    res.setHeader('Cache-Control', 'no-store');
    const metrics = buildRouteMetricsRedacted(routeKey);
    if (!metrics) return res.status(404).json({ error: 'Metrics unavailable' });
    res.json({ ok: true, metrics });
  });

  app.get('/api/local-route-explorer/v1/metrics', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, routes: buildAllRouteMetricsRedacted() });
  });

  app.get('/api/local-route-explorer/v1/routes/:routeKey/observations.geojson', (req, res) => {
    const routeKey = req.params.routeKey;
    if (!isAllowedObservationRouteKey(routeKey)) {
      return res.status(404).json({ error: 'Unknown observation route' });
    }
    if (req.query.path || req.query.file) {
      return res.status(400).json({ error: 'Path parameters not allowed' });
    }
    res.setHeader('Cache-Control', 'no-store');
    const preview = ensureDerivedPreviewGeojson(routeKey);
    if (!preview.ok || !fs.existsSync(preview.previewPath)) {
      return res.status(404).json({ error: 'Observations unavailable' });
    }
    res.type('application/geo+json; charset=UTF-8');
    res.send(fs.readFileSync(preview.previewPath, 'utf8'));
  });

  app.get('/api/local-route-explorer/v1/routes/:routeKey/comparison/summary', (req, res) => {
    const routeKey = req.params.routeKey;
    if (!isAllowedObservationRouteKey(routeKey)) {
      return res.status(404).json({ error: 'Unknown observation route' });
    }
    res.setHeader('Cache-Control', 'no-store');
    const sp = comparisonSummaryPath(routeComparisonDir(routeKey));
    if (!fs.existsSync(sp)) {
      return res.status(404).json({ error: 'Comparison not built' });
    }
    const summary = JSON.parse(fs.readFileSync(sp, 'utf8'));
    const geoPath = roadSectionsPath(routeComparisonDir(routeKey));
    const geo = fs.existsSync(geoPath) ? JSON.parse(fs.readFileSync(geoPath, 'utf8')) : null;
    const uiSummary = geo ? computeUiSummaryFromFeatures(geo.features) : null;
    res.json({
      ok: true,
      manifest: safeComparisonManifest(summary, uiSummary, routeKey),
      spec: observationRouteSpec(routeKey),
    });
  });

  app.get('/api/local-route-explorer/v1/routes/:routeKey/comparison/way/:osmId', (req, res) => {
    const routeKey = req.params.routeKey;
    const osmId = req.params.osmId;
    if (!isAllowedObservationRouteKey(routeKey)) {
      return res.status(404).json({ error: 'Unknown observation route' });
    }
    res.setHeader('Cache-Control', 'no-store');
    const payload = lookupSelectedRouteOsmComparison(routeKey, normalizeOsmWayId(osmId));
    if (!payload.ok) {
      return res.status(404).json({ error: 'Unknown observation route' });
    }
    res.json({ ok: true, comparison: payload });
  });

  app.get('/api/local-route-explorer/v1/routes/:routeKey/comparison/sections.geojson', (req, res) => {
    const routeKey = req.params.routeKey;
    if (!isAllowedObservationRouteKey(routeKey)) {
      return res.status(404).json({ error: 'Unknown observation route' });
    }
    res.setHeader('Cache-Control', 'no-store');
    const gp = roadSectionsPath(routeComparisonDir(routeKey));
    if (!fs.existsSync(gp)) return res.status(404).json({ error: 'Not found' });
    const geo = JSON.parse(fs.readFileSync(gp, 'utf8'));
    const enriched = enrichSectionsForRoute({ ...geo, features: geo.features.map((f) => ({ ...f })) }, routeKey);
    res.type('application/geo+json; charset=UTF-8');
    res.send(JSON.stringify(enriched));
  });
}

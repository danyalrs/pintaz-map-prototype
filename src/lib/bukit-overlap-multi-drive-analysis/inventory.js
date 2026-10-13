import fs from 'node:fs';
import { ROUTE_RESULTS_PRIVATE_PATH } from '../bukit-page1-probe-paths.js';
import { updateEnvelopePath } from '../update-preview-paths.js';
import { validateCompleteRoute } from '../bukit-overlap-route-selection/route-inventory.js';
import { ANALYSIS_ROUTES } from './config.js';

function dongleGroupMap(routeResults) {
  const dongles = [...new Set(routeResults.routes.filter((r) => r.dongle).map((r) => r.dongle))].sort();
  const m = new Map();
  dongles.forEach((d, i) => m.set(d, `dongle-group-${String.fromCharCode(65 + i)}`));
  m.set('__active__', 'dongle-group-active');
  return m;
}

export function buildAnalysisInventory() {
  const routeResults = JSON.parse(fs.readFileSync(ROUTE_RESULTS_PRIVATE_PATH, 'utf8'));
  const envelope = JSON.parse(fs.readFileSync(updateEnvelopePath(), 'utf8'));
  const byProbe = new Map(routeResults.routes.map((r) => [r.probe_ref, r]));
  const groupMap = dongleGroupMap(routeResults);
  if (envelope.source_dongle) groupMap.set(envelope.source_dongle, 'dongle-group-active');
  const routes = [];
  const redacted_public = [];
  for (const spec of ANALYSIS_ROUTES) {
    const row = validateCompleteRoute(spec.route_key, spec.probe_ref, byProbe, groupMap);
    if (spec.route_key === 'active') {
      row.public.dongle_group = 'dongle-group-active';
    }
    routes.push(row);
    redacted_public.push(row.public);
  }
  return {
    schema: 'pintaz.bukit.overlap-multi-drive.inventory',
    version: 1,
    route_count: routes.length,
    distinct_dongle_groups: new Set(redacted_public.map((r) => r.dongle_group)).size,
    routes,
    redacted_public,
    envelope_acceptance_pending: envelope.acceptance_state === 'pending' || !envelope.acceptance_state,
  };
}

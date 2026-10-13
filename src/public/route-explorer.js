import {
  applyServerEvidenceVisibility,
  invalidateObservationGeojsonCache,
  renderServerEvidencePanel,
} from './server-observation-evidence.js?v=osm-turn-lane-guidance-v2';
import { loadComparisonForArea } from './map-selection.js?v=osm-turn-lane-guidance-v2';
import {
  getObservationRouteKey,
  setObservationRouteKey,
  isDiagnosticObservationRoute,
} from './observation-route-state.js?v=osm-turn-lane-guidance-v2';

let catalog = null;

export { getObservationRouteKey, isDiagnosticObservationRoute };

function el(id) {
  return document.getElementById(id);
}

function renderMetrics(metrics) {
  const dl = el('observation-route-metrics');
  const banner = el('observation-route-diagnostic-banner');
  if (banner) {
    banner.classList.toggle('hidden', !metrics?.diagnostic_only);
  }
  if (!dl || !metrics) return;
  const b = metrics.corridor_bounds;
  const boundsText =
    b && Number.isFinite(b.west)
      ? `W ${b.west.toFixed(5)} S ${b.south.toFixed(5)} E ${b.east.toFixed(5)} N ${b.north.toFixed(5)}`
      : '—';
  const tags = (metrics.inventory_tags || []).join(', ') || '—';
  const rows = [
    ['Route status', metrics.route_status || '—'],
    ['Feature total', metrics.feature_total],
    ['Inside pilot', metrics.inside_pilot_total],
    ['Vehicle poses', metrics.counts_by_layer?.vehicle_pose],
    ['Lane points', metrics.counts_by_layer?.lane_point],
    ['Edge points', metrics.counts_by_layer?.edge_point],
    ['GPS points', metrics.counts_by_layer?.gps_point],
    ['Corridor bounds (inside pilot)', boundsText],
    ['OSM ways touched', metrics.osm_ways_touched ?? '—'],
    ['Inventory tags', tags],
  ];
  dl.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v ?? '—'}</dd>`).join('');
}

async function fetchMetrics(routeKey) {
  const res = await fetch(`/api/local-route-explorer/v1/routes/${encodeURIComponent(routeKey)}/metrics`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.metrics;
}

export async function reloadObservationRouteViews(map, getAreaId) {
  const areaId = getAreaId();
  const metrics = await fetchMetrics(getObservationRouteKey());
  renderMetrics(metrics);
  const scope = el('road-comparison-scope-note');
  if (scope) {
    scope.textContent = isDiagnosticObservationRoute()
      ? `Per-route OSM comparison for ${getObservationRouteKey()} (diagnostic only — not cross-drive confirmation).`
      : 'Complete active route — production comparison vs OSM lane baseline.';
  }
  const resetBtn = el('comparison-reset-proposals');
  if (resetBtn) resetBtn.disabled = isDiagnosticObservationRoute();

  await loadComparisonForArea(map, areaId);
  const evidenceOn = el('server-evidence-toggle')?.checked;
  if (evidenceOn) {
    await applyServerEvidenceVisibility(map, true);
  }
}

export async function initRouteExplorerUi(map, { getAreaId }) {
  try {
    const res = await fetch('/api/local-route-explorer/v1/routes');
    if (res.ok) catalog = await res.json();
  } catch {
    catalog = null;
  }

  const select = el('observation-route-selector');
  if (select && catalog?.routes) {
    select.innerHTML = catalog.routes
      .map(
        (r) =>
          `<option value="${r.route_key}"${r.route_key === 'active' ? ' selected' : ''}>${r.option_label}</option>`
      )
      .join('');
  }

  await reloadObservationRouteViews(map, getAreaId);

  select?.addEventListener('change', async (e) => {
    setObservationRouteKey(e.target.value || 'active');
    invalidateObservationGeojsonCache();
    await reloadObservationRouteViews(map, getAreaId);
    renderServerEvidencePanel();
  });
}

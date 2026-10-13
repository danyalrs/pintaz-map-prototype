import { getObservationRouteKey } from './observation-route-state.js?v=osm-turn-lane-guidance-v2';

export async function fetchOsmVsSelectedRouteComparison(osmId, routeKey = getObservationRouteKey()) {
  const raw = String(osmId ?? '').trim();
  if (!raw || !routeKey) return null;
  const osmKey = /^\d+(\.0+)?$/.test(raw) ? String(Math.trunc(Number(raw))) : raw;
  const res = await fetch(
    `/api/local-route-explorer/v1/routes/${encodeURIComponent(routeKey)}/comparison/way/${encodeURIComponent(osmKey)}`
  );
  if (!res.ok) return null;
  const body = await res.json();
  return body.comparison ?? null;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Human-readable comparison result for the selected-road panel badge. */
export function comparisonResultBadgeLabel(comparisonResult) {
  switch (comparisonResult) {
    case 'alignment_consistent':
      return 'Aligned with OSM baseline';
    case 'insufficient_evidence':
      return 'Insufficient evidence';
    case 'not_evaluated':
      return 'Not evaluated for this route';
    case 'mismatch_candidate':
      return 'Possible mismatch (gated)';
    default:
      return 'Not evaluated for this route';
  }
}

function badgeClass(comparisonResult) {
  switch (comparisonResult) {
    case 'alignment_consistent':
      return 'osm-vs-route-badge osm-vs-route-badge--aligned';
    case 'insufficient_evidence':
      return 'osm-vs-route-badge osm-vs-route-badge--insufficient';
    case 'mismatch_candidate':
      return 'osm-vs-route-badge osm-vs-route-badge--mismatch';
    default:
      return 'osm-vs-route-badge osm-vs-route-badge--unknown';
  }
}

export function formatOsmVsSelectedRouteBlock(comparison) {
  if (!comparison?.comparison_available) {
    return `<section class="osm-vs-route-block" aria-label="OSM vs selected route">
      <h3 class="osm-vs-route-heading">OSM vs selected route</h3>
      <p class="muted small">Not evaluated for this route</p>
    </section>`;
  }

  const result = comparison.comparison_result;
  const badgeLabel = comparisonResultBadgeLabel(result);
  const gate =
    result === 'insufficient_evidence' || result === 'not_evaluated' ? comparison.first_failed_gate : null;
  const obs = comparison.observation_counts || {};

  const rows = [
    ['Selected route', comparison.route_label],
    ['Route state', comparison.route_state_label],
    ['OSM lane count', comparison.osm_lane_count_label ?? 'Not provided'],
    ['Vehicle frames', obs.vehicle_frames ?? 0],
    ['Lane observations', obs.lane_observations ?? 0],
    ['Edge observations', obs.edge_observations ?? 0],
  ];
  if (gate) rows.push(['First failed gate', gate]);
  rows.push(['Proposal status', comparison.proposal_status]);

  const dl = rows
    .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v ?? 'Not provided')}</dd>`)
    .join('');

  return `<section class="osm-vs-route-block" aria-label="OSM vs selected route">
    <h3 class="osm-vs-route-heading">OSM vs selected route</h3>
    <p class="osm-vs-route-map-hint muted small">The green comparison-section highlight on the map shows where observations were grouped along this road — it is not by itself proof that OSM and server data agree.</p>
    <p class="${badgeClass(result)}" role="status">${escapeHtml(badgeLabel)}</p>
    <dl class="status-dl compact-dl osm-vs-route-dl">${dl}</dl>
  </section>`;
}

import { formatSelectedRoadCard } from '/lib/road-lane-info.js?v=osm-turn-lane-guidance-v2';
import { fetchDerivedRoadInfo } from './lane-baseline-layers.js?v=osm-turn-lane-guidance-v2';
import { HIGHLIGHT_LAYER_ID, DETAILED_FILL_LAYER_IDS } from './detailed-road-layers.js?v=osm-turn-lane-guidance-v2';
import {
  handleObservationEvidenceClick,
  clearObservationSelection,
} from './server-observation-evidence.js?v=osm-turn-lane-guidance-v2';
import { observationClickQueryBox } from '/lib/update-preview-click.js?v=osm-turn-lane-guidance-v2';
import {
  boundsForFeatures,
  fitOptionsForSectionLength,
} from '/lib/comparison-fit-bounds.js?v=osm-turn-lane-guidance-v2';
import { formatRoadInfo } from '/lib/road-click-info.js?v=osm-turn-lane-guidance-v2';
import { formatDistanceMetres, formatConfidence, formatCount } from '/lib/format-display.js?v=osm-turn-lane-guidance-v2';
import {
  getObservationRouteKey,
  isDiagnosticObservationRoute,
} from './observation-route-state.js?v=osm-turn-lane-guidance-v2';
import {
  fetchOsmVsSelectedRouteComparison,
  formatOsmVsSelectedRouteBlock,
} from './osm-vs-selected-route-panel.js?v=osm-turn-lane-guidance-v2';

async function appendOsmVsSelectedRouteBlock(html, osmId) {
  const comparison = await fetchOsmVsSelectedRouteComparison(osmId, getObservationRouteKey());
  return `${html}${formatOsmVsSelectedRouteBlock(comparison)}`;
}

export const COMPARISON_SOURCE_ID = 'pintaz-comparison-sections';
export const COMPARISON_HIGHLIGHT_SOURCE_ID = 'pintaz-comparison-highlight';
export const SELECTED_ROAD_ENDPOINTS_SOURCE = 'pintaz-selected-road-endpoints';
export const SELECTED_ROAD_ONEWAY_SOURCE = 'pintaz-selected-road-oneway';

export const LAYER = {
  diagnosticInsufficient: 'pintaz-comparison-diagnostic-insufficient',
  diagnosticAmbiguous: 'pintaz-comparison-diagnostic-ambiguous',
  verifiedCasing: 'pintaz-comparison-verified-casing',
  verifiedLine: 'pintaz-comparison-verified-line',
  verifiedHit: 'pintaz-comparison-verified-hit',
  proposedPendingCasing: 'pintaz-comparison-proposed-pending-casing',
  proposedPendingLine: 'pintaz-comparison-proposed-pending-line',
  proposedPendingHit: 'pintaz-comparison-proposed-pending-hit',
  proposedAcceptedCasing: 'pintaz-comparison-proposed-accepted-casing',
  proposedAcceptedLine: 'pintaz-comparison-proposed-accepted-line',
  proposedAcceptedHit: 'pintaz-comparison-proposed-accepted-hit',
  proposedRejectedCasing: 'pintaz-comparison-proposed-rejected-casing',
  proposedRejectedLine: 'pintaz-comparison-proposed-rejected-line',
  proposedRejectedHit: 'pintaz-comparison-proposed-rejected-hit',
  sectionHighlight: 'pintaz-comparison-section-highlight',
};

const COMPARISON_AREA = 'bukit-bintang-imbi';
const LINE_HIT = 8;
const COMPARISON_HIT_WIDTH = 18;

const selectionState = {
  comparisonLoaded: false,
  comparisonDataAvailable: false,
  evidenceVisible: false,
  comparisonSectionsVisible: true,
  showAmbiguousDiagnostic: false,
  showInsufficientDiagnostic: false,
  features: [],
  uiSummary: null,
  selectedSectionId: null,
};

function el(id) {
  return document.getElementById(id);
}

export function showMapSelectionCard(mode, html, titleOverride) {
  const card = el('map-selection-card');
  const body = el('map-selection-card-body');
  const title = el('map-selection-card-title');
  if (!card || !body || !title) return;
  card.classList.remove('hidden');
  card.dataset.mode = mode;
  const titles = {
    road: 'Selected road',
    verified: 'Verified road section',
    proposed: 'Proposed map change',
    diagnostic: 'Comparison diagnostic',
    observation: 'Observation info',
    'mismatch-candidate': 'Proposed map update',
    'mismatch-verified': 'Verified lane section',
    'mismatch-diagnostic': 'Mismatch diagnostic',
    'multi-drive': 'Multi-drive OSM comparison',
  };
  title.textContent = titleOverride || titles[mode] || 'Selection';
  body.innerHTML = html;
}

export function hideSelectionCard() {
  el('map-selection-card')?.classList.add('hidden');
}

function clearSectionHighlight(map) {
  selectionState.selectedSectionId = null;
  if (map?.getSource(COMPARISON_HIGHLIGHT_SOURCE_ID)) {
    map.getSource(COMPARISON_HIGHLIGHT_SOURCE_ID).setData({ type: 'FeatureCollection', features: [] });
  }
}

export function clearComparisonSelection(map) {
  clearSectionHighlight(map);
}

function clearSelectedRoadMarkers(map) {
  if (map?.getSource(SELECTED_ROAD_ENDPOINTS_SOURCE)) {
    map.getSource(SELECTED_ROAD_ENDPOINTS_SOURCE).setData({ type: 'FeatureCollection', features: [] });
  }
  if (map?.getSource(SELECTED_ROAD_ONEWAY_SOURCE)) {
    map.getSource(SELECTED_ROAD_ONEWAY_SOURCE).setData({ type: 'FeatureCollection', features: [] });
  }
}

export function clearAllSelections(map, { clearOsmRoadHighlight } = {}) {
  hideSelectionCard();
  clearObservationSelection(map);
  clearSelectedRoadMarkers(map);
  clearSectionHighlight(map);
  clearOsmRoadHighlight?.();
  setObservationPanelDefault();
}

function setObservationPanelDefault() {
  const obs = el('observation-info');
  if (obs) {
    obs.textContent = 'Click an update observation on the map.';
    obs.classList.add('muted');
  }
}

function queryLineLayers(map, point, layerIds) {
  const ids = layerIds.filter((id) => map.getLayer(id));
  if (!ids.length) return [];
  const box = observationClickQueryBox(point, LINE_HIT);
  return map.queryRenderedFeatures(box, { layers: ids });
}

function displayMetric(key, value) {
  if (value == null || value === '') return 'Not provided';
  if (key.includes('length') || key.includes('distance')) return formatDistanceMetres(value);
  if (key === 'Confidence') return formatConfidence(value);
  if (key.includes('frames') || key.includes('observations')) return formatCount(value);
  if (key.includes('Heading')) return formatConfidence(value);
  return String(value);
}

function metricRows(props) {
  const rows = [
    ['OSM road name', props.name || 'Not provided'],
    ['OSM ID', props.osm_id],
    ['Classification', props.classification],
    ['Section length (m)', props.section_length_m],
    ['Vehicle frames', props.vehicle_frames],
    ['Lane observations', props.lane_observations],
    ['Edge observations', props.edge_observations],
    ['GPS observations', props.gps_observations],
    ['Median distance (m)', props.median_distance_m],
    ['P90 distance (m)', props.p90_distance_m],
    ['Heading diff (°)', props.median_heading_diff_deg],
    ['Confidence', props.confidence],
    ['Partial data', props.partial_page_scope],
  ];
  return rows.map(([k, v]) => [k, k === 'OSM road name' || k === 'OSM ID' || k === 'Classification' || k === 'Partial data' ? v : displayMetric(k, v)]);
}

function formatVerifiedHtml(props) {
  const dl = metricRows(props)
    .map(([k, v]) => `<dt>${k}</dt><dd>${v ?? 'Not provided'}</dd>`)
    .join('');
  const reasons = (props.reasons || []).map((r) => `<li>${r}</li>`).join('');
  const baseline = `<details class="proposal-baseline"><summary>Baseline OSM road info</summary><div class="road-info-card">${formatRoadInfo(props).replace(/\n/g, '<br>')}</div></details>`;
  return `<p class="verified-banner">No map change suggested</p>
    <p class="partial-warning">Verified section — no map change suggested. Truncated page 1 only.</p>
    <dl class="status-dl compact-dl">${dl}</dl>
    <p><strong>Why consistent</strong></p><ul>${reasons}</ul>${baseline}`;
}

function formatProposedHtml(props) {
  const rows = [...metricRows(props), ['Decision', props.proposed_state || props.decision_state || 'pending']];
  const dl = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v ?? 'Not provided'}</dd>`).join('');
  const reasons = (props.reasons || []).map((r) => `<li>${r}</li>`).join('');
  const baseline = `<details class="proposal-baseline"><summary>Matched OSM baseline</summary><dl class="status-dl compact-dl">
    <dt>OSM ID</dt><dd>${props.osm_id}</dd><dt>Name</dt><dd>${props.name || 'Not provided'}</dd></dl></details>`;
  return `<p class="partial-warning">Review only — possible map change. Truncated page 1.</p>
    <dl class="status-dl compact-dl">${dl}</dl>${baseline}<p><strong>Reasons</strong></p><ul>${reasons}</ul>
    <div class="btn-row"><button type="button" id="proposal-accept-btn" class="btn btn-primary">Accept</button>
    <button type="button" id="proposal-reject-btn" class="btn btn-secondary">Reject</button></div>`;
}

function formatDiagnosticHtml(props) {
  const dl = metricRows(props)
    .map(([k, v]) => `<dt>${k}</dt><dd>${v ?? 'Not provided'}</dd>`)
    .join('');
  const reasons = (props.reasons || []).map((r) => `<li>${r}</li>`).join('');
  return `<p class="partial-warning">Diagnostic only — not a map change proposal.</p>
    <dl class="status-dl compact-dl">${dl}</dl><p><strong>Reasons</strong></p><ul>${reasons}</ul>`;
}

function highlightSection(map, feature) {
  selectionState.selectedSectionId = feature.properties?.proposal_id;
  if (!map.getSource(COMPARISON_HIGHLIGHT_SOURCE_ID)) return;
  map.getSource(COMPARISON_HIGHLIGHT_SOURCE_ID).setData({
    type: 'FeatureCollection',
    features: [feature],
  });
}

function highlightSelectedRoad(map, props, geometry) {
  map.setFilter(HIGHLIGHT_LAYER_ID, ['==', ['get', 'osm_id'], String(props.osm_id)]);
  const coords = geometry?.coordinates;
  if (!coords || coords.length < 2) {
    clearSelectedRoadMarkers(map);
    return;
  }
  const start = coords[0];
  const end = coords[coords.length - 1];
  const features = [
    { type: 'Feature', properties: { role: 'start' }, geometry: { type: 'Point', coordinates: start } },
    { type: 'Feature', properties: { role: 'end' }, geometry: { type: 'Point', coordinates: end } },
  ];
  if (!map.getSource(SELECTED_ROAD_ENDPOINTS_SOURCE)) {
    map.addSource(SELECTED_ROAD_ENDPOINTS_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer(
      {
        id: 'pintaz-selected-road-start',
        type: 'circle',
        source: SELECTED_ROAD_ENDPOINTS_SOURCE,
        filter: ['==', ['get', 'role'], 'start'],
        paint: { 'circle-radius': 7, 'circle-color': '#0ea5e9', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' },
      },
      HIGHLIGHT_LAYER_ID
    );
    map.addLayer(
      {
        id: 'pintaz-selected-road-end',
        type: 'circle',
        source: SELECTED_ROAD_ENDPOINTS_SOURCE,
        filter: ['==', ['get', 'role'], 'end'],
        paint: { 'circle-radius': 7, 'circle-color': '#1e3a8a', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' },
      },
      HIGHLIGHT_LAYER_ID
    );
  }
  map.getSource(SELECTED_ROAD_ENDPOINTS_SOURCE).setData({ type: 'FeatureCollection', features });

  const oneway =
    String(props.oneway || '').toLowerCase() === 'yes' ||
    String(props.oneway || '').toLowerCase() === '1' ||
    String(props.oneway || '').toLowerCase() === 'true';
  const onewayLine = oneway && geometry?.type === 'LineString'
    ? { type: 'Feature', properties: {}, geometry }
    : null;
  if (!map.getSource(SELECTED_ROAD_ONEWAY_SOURCE)) {
    map.addSource(SELECTED_ROAD_ONEWAY_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer(
      {
        id: 'pintaz-selected-road-oneway-arrows',
        type: 'symbol',
        source: SELECTED_ROAD_ONEWAY_SOURCE,
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 40,
          'text-field': '▶',
          'text-size': 14,
          'text-keep-upright': false,
          'text-rotation-alignment': 'map',
        },
        paint: { 'text-color': '#1d4ed8', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
      },
      HIGHLIGHT_LAYER_ID
    );
  }
  map.getSource(SELECTED_ROAD_ONEWAY_SOURCE).setData({
    type: 'FeatureCollection',
    features: onewayLine ? [onewayLine] : [],
  });
}

function addComparisonLayer(map, layerDef, beforeId) {
  if (!map.getLayer(layerDef.id)) {
    map.addLayer(layerDef, beforeId);
  }
}

function removeLegacyComparisonLayers(map) {
  const legacy = ['pintaz-proposal-sections', 'pintaz-proposal-ambiguous'];
  for (const id of legacy) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(COMPARISON_SOURCE_ID) && !map.getLayer(LAYER.verifiedLine)) {
    for (const id of Object.values(LAYER)) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of [
      'pintaz-comparison-diagnostic-insufficient-hit',
      'pintaz-comparison-diagnostic-ambiguous-hit',
    ]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    if (map.getLayer(LAYER.sectionHighlight)) map.removeLayer(LAYER.sectionHighlight);
    map.removeSource(COMPARISON_SOURCE_ID);
    if (map.getSource(COMPARISON_HIGHLIGHT_SOURCE_ID)) {
      map.removeSource(COMPARISON_HIGHLIGHT_SOURCE_ID);
    }
  }
}

export function ensureComparisonLayers(map) {
  if (!map) return;
  removeLegacyComparisonLayers(map);
  if (map.getSource(COMPARISON_SOURCE_ID)) return;
  map.addSource(COMPARISON_SOURCE_ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addSource(COMPARISON_HIGHLIGHT_SOURCE_ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  const before = HIGHLIGHT_LAYER_ID;
  const diag = (id, kind) => ({
    id,
    type: 'line',
    source: COMPARISON_SOURCE_ID,
    filter: ['all', ['==', ['get', 'ui_group'], 'diagnostic'], ['==', ['get', 'diagnostic_kind'], kind]],
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
    paint: { 'line-color': '#94a3b8', 'line-width': 3, 'line-opacity': 0.65, 'line-dasharray': [2, 2] },
  });

  addComparisonLayer(map, diag(LAYER.diagnosticInsufficient, 'insufficient'), before);
  addComparisonLayer(map, diag(LAYER.diagnosticAmbiguous, 'ambiguous'), before);
  for (const [id, kind] of [
    ['pintaz-comparison-diagnostic-insufficient-hit', 'insufficient'],
    ['pintaz-comparison-diagnostic-ambiguous-hit', 'ambiguous'],
  ]) {
    addComparisonLayer(
      map,
      {
        id,
        type: 'line',
        source: COMPARISON_SOURCE_ID,
        filter: ['all', ['==', ['get', 'ui_group'], 'diagnostic'], ['==', ['get', 'diagnostic_kind'], kind]],
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-color': '#94a3b8', 'line-width': COMPARISON_HIT_WIDTH, 'line-opacity': 0.01 },
      },
      before
    );
  }

  addComparisonLayer(
    map,
    {
      id: LAYER.verifiedCasing,
      type: 'line',
      source: COMPARISON_SOURCE_ID,
      filter: ['==', ['get', 'ui_group'], 'verified'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#0f766e', 'line-width': 9, 'line-opacity': 0.85 },
    },
    before
  );
  addComparisonLayer(
    map,
    {
      id: LAYER.verifiedLine,
      type: 'line',
      source: COMPARISON_SOURCE_ID,
      filter: ['==', ['get', 'ui_group'], 'verified'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#14b8a6', 'line-width': 6, 'line-opacity': 0.95 },
    },
    before
  );
  addComparisonLayer(
    map,
    {
      id: LAYER.verifiedHit,
      type: 'line',
      source: COMPARISON_SOURCE_ID,
      filter: ['==', ['get', 'ui_group'], 'verified'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#14b8a6', 'line-width': COMPARISON_HIT_WIDTH, 'line-opacity': 0.01 },
    },
    before
  );

  const proposedStack = (state, casingId, lineId, hitId, color, casing) => {
    const stateFilter = ['all', ['==', ['get', 'ui_group'], 'proposed'], ['==', ['get', 'proposed_state'], state]];
    addComparisonLayer(
      map,
      {
        id: casingId,
        type: 'line',
        source: COMPARISON_SOURCE_ID,
        filter: stateFilter,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': casing, 'line-width': 9, 'line-opacity': 0.85 },
      },
      before
    );
    addComparisonLayer(
      map,
      {
        id: lineId,
        type: 'line',
        source: COMPARISON_SOURCE_ID,
        filter: stateFilter,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': color, 'line-width': 6, 'line-opacity': 0.95 },
      },
      before
    );
    addComparisonLayer(
      map,
      {
        id: hitId,
        type: 'line',
        source: COMPARISON_SOURCE_ID,
        filter: stateFilter,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': color, 'line-width': COMPARISON_HIT_WIDTH, 'line-opacity': 0.01 },
      },
      before
    );
  };

  proposedStack('pending', LAYER.proposedPendingCasing, LAYER.proposedPendingLine, LAYER.proposedPendingHit, '#f59e0b', '#b45309');
  proposedStack('accepted', LAYER.proposedAcceptedCasing, LAYER.proposedAcceptedLine, LAYER.proposedAcceptedHit, '#16a34a', '#14532d');
  proposedStack('rejected', LAYER.proposedRejectedCasing, LAYER.proposedRejectedLine, LAYER.proposedRejectedHit, '#dc2626', '#7f1d1d');

  addComparisonLayer(
    map,
    {
      id: LAYER.sectionHighlight,
      type: 'line',
      source: COMPARISON_HIGHLIGHT_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 10, 'line-opacity': 0.9 },
    },
    before
  );

  applyComparisonLayerVisibility(map);
}

export function applyComparisonLayerVisibility(map) {
  if (!map) return;
  const mainOn = selectionState.comparisonSectionsVisible ? 'visible' : 'none';
  const ambOn = selectionState.showAmbiguousDiagnostic ? 'visible' : 'none';
  const insOn = selectionState.showInsufficientDiagnostic ? 'visible' : 'none';

  for (const id of [
    LAYER.verifiedCasing,
    LAYER.verifiedLine,
    LAYER.verifiedHit,
    LAYER.proposedPendingCasing,
    LAYER.proposedPendingLine,
    LAYER.proposedPendingHit,
    LAYER.proposedAcceptedCasing,
    LAYER.proposedAcceptedLine,
    LAYER.proposedAcceptedHit,
    LAYER.proposedRejectedCasing,
    LAYER.proposedRejectedLine,
    LAYER.proposedRejectedHit,
  ]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', mainOn);
  }
  if (map.getLayer(LAYER.diagnosticAmbiguous)) {
    map.setLayoutProperty(LAYER.diagnosticAmbiguous, 'visibility', ambOn);
  }
  if (map.getLayer(LAYER.diagnosticInsufficient)) {
    map.setLayoutProperty(LAYER.diagnosticInsufficient, 'visibility', insOn);
  }
}

function updateRoadComparisonPanel(areaId) {
  const panel = el('road-comparison-panel');
  const empty = el('road-comparison-empty');
  const body = el('road-comparison-body');
  const noArea = el('road-comparison-no-area');
  if (!panel) return;

  if (areaId !== COMPARISON_AREA) {
    panel.classList.remove('hidden');
    empty?.classList.add('hidden');
    body?.classList.add('hidden');
    noArea?.classList.remove('hidden');
    return;
  }

  noArea?.classList.add('hidden');
  if (!selectionState.comparisonDataAvailable) {
    panel.classList.remove('hidden');
    empty?.classList.remove('hidden');
    body?.classList.add('hidden');
    return;
  }

  empty?.classList.add('hidden');
  body?.classList.remove('hidden');
  panel.classList.remove('hidden');

  const s = selectionState.uiSummary || {};
  const set = (id, v) => {
    const n = el(id);
    if (n) n.textContent = String(v ?? 0);
  };
  set('comparison-count-verified', s.verified);
  set('comparison-count-proposed', s.proposed);
  set('comparison-count-ambiguous', s.ambiguous);
  set('comparison-count-insufficient', s.insufficient_evidence);

  const zoomVerified = el('comparison-zoom-verified');
  const zoomProposed = el('comparison-zoom-proposed');
  const proposedHint = el('comparison-no-proposed-hint');
  if (zoomVerified) {
    zoomVerified.disabled = !s.verified;
    zoomVerified.classList.toggle('hidden', !s.verified);
  }
  if (zoomProposed) {
    const hasProposed = (s.proposed ?? 0) > 0;
    zoomProposed.disabled = !hasProposed;
    zoomProposed.classList.toggle('hidden', !hasProposed);
  }
  if (proposedHint) {
    proposedHint.classList.toggle('hidden', (s.proposed ?? 0) > 0);
  }
}

export async function loadComparisonForArea(map, areaId) {
  updateRoadComparisonPanel(areaId);
  if (areaId !== COMPARISON_AREA) {
    if (map?.getSource(COMPARISON_SOURCE_ID)) {
      map.getSource(COMPARISON_SOURCE_ID).setData({ type: 'FeatureCollection', features: [] });
    }
    selectionState.comparisonLoaded = false;
    selectionState.comparisonDataAvailable = false;
    selectionState.features = [];
    clearSectionHighlight(map);
    hideSelectionCard();
    return;
  }
  try {
    const routeKey = getObservationRouteKey();
    const sumRes = await fetch(
      `/api/local-route-explorer/v1/routes/${encodeURIComponent(routeKey)}/comparison/summary`
    );
    if (!sumRes.ok) {
      selectionState.comparisonDataAvailable = false;
      updateRoadComparisonPanel(areaId);
      return;
    }
    const sum = await sumRes.json();
    selectionState.uiSummary = sum.manifest?.ui_summary ?? null;

    const res = await fetch(
      `/api/local-route-explorer/v1/routes/${encodeURIComponent(routeKey)}/comparison/sections.geojson`
    );
    if (!res.ok) {
      selectionState.comparisonDataAvailable = false;
      updateRoadComparisonPanel(areaId);
      return;
    }
    const data = await res.json();
    ensureComparisonLayers(map);
    map.getSource(COMPARISON_SOURCE_ID).setData(data);
    selectionState.comparisonLoaded = true;
    selectionState.comparisonDataAvailable = true;
    selectionState.features = data.features || [];
    applyComparisonLayerVisibility(map);
    updateRoadComparisonPanel(areaId);
  } catch {
    selectionState.comparisonDataAvailable = false;
    updateRoadComparisonPanel(areaId);
  }
}

export function zoomToComparisonGroup(map, uiGroup) {
  if (!map || !selectionState.features.length) return;
  const feats = selectionState.features.filter((f) => f.properties?.ui_group === uiGroup);
  if (!feats.length) return;
  const bounds = boundsForFeatures(feats);
  if (!bounds) return;
  map.resize();
  const maxLen = Math.max(...feats.map((f) => Number(f.properties?.section_length_m) || 0));
  map.fitBounds(bounds, fitOptionsForSectionLength(maxLen));
}

async function postProposalDecision(proposalId, state) {
  const res = await fetch('/api/comparison/v1/proposal/decision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proposal_id: proposalId, state }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Proposal decision failed');
  }
}

function comparisonClickLayerIds() {
  const ids = [];
  if (selectionState.comparisonSectionsVisible) {
    ids.push(
      LAYER.proposedPendingHit,
      LAYER.proposedAcceptedHit,
      LAYER.proposedRejectedHit,
      LAYER.verifiedHit
    );
  }
  if (selectionState.showAmbiguousDiagnostic) {
    ids.push('pintaz-comparison-diagnostic-ambiguous-hit', LAYER.diagnosticAmbiguous);
  }
  if (selectionState.showInsufficientDiagnostic) {
    ids.push('pintaz-comparison-diagnostic-insufficient-hit', LAYER.diagnosticInsufficient);
  }
  return ids;
}

function bindProposedActions(map, areaId, props) {
  if (isDiagnosticObservationRoute()) return;
  el('proposal-accept-btn')?.addEventListener('click', async () => {
    await postProposalDecision(props.proposal_id, 'accepted');
    await loadComparisonForArea(map, areaId);
    showMapSelectionCard('proposed', formatProposedHtml({ ...props, proposed_state: 'accepted' }));
  });
  el('proposal-reject-btn')?.addEventListener('click', async () => {
    await postProposalDecision(props.proposal_id, 'rejected');
    await loadComparisonForArea(map, areaId);
    showMapSelectionCard('proposed', formatProposedHtml({ ...props, proposed_state: 'rejected' }));
  });
}

function renderSelectedRoadHtml(props, derived) {
  const text = formatSelectedRoadCard(props, derived);
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
  return `<div class="road-info-card selected-road-lane-card">${escaped}</div>`;
}

export function initMapSelection(map, {
  getAreaId,
  clearOsmRoadHighlight,
  onEvidenceVisibilityChange,
  tryMismatchCandidateClick,
  tryMismatchNonCandidateClick,
  tryMultiDriveCandidateClick,
  tryMultiDriveConsistentClick,
  tryMultiDriveDiagnosticClick,
}) {
  el('map-selection-card-close')?.addEventListener('click', () => clearAllSelections(map, { clearOsmRoadHighlight }));

  el('comparison-reset-proposals')?.addEventListener('click', async () => {
    if (isDiagnosticObservationRoute()) return;
    await fetch('/api/comparison/v1/proposals/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    await loadComparisonForArea(map, getAreaId());
  });

  el('comparison-sections-toggle')?.addEventListener('change', (e) => {
    selectionState.comparisonSectionsVisible = e.target.checked;
    applyComparisonLayerVisibility(map);
  });

  el('comparison-show-ambiguous')?.addEventListener('change', (e) => {
    selectionState.showAmbiguousDiagnostic = e.target.checked;
    applyComparisonLayerVisibility(map);
  });

  el('comparison-show-insufficient')?.addEventListener('change', (e) => {
    selectionState.showInsufficientDiagnostic = e.target.checked;
    applyComparisonLayerVisibility(map);
  });

  el('comparison-zoom-verified')?.addEventListener('click', () => zoomToComparisonGroup(map, 'verified'));
  el('comparison-zoom-proposed')?.addEventListener('click', () => zoomToComparisonGroup(map, 'proposed'));

  el('server-evidence-toggle')?.addEventListener('change', (e) => {
    selectionState.evidenceVisible = e.target.checked;
    onEvidenceVisibilityChange?.(selectionState.evidenceVisible);
  });

  return function handleMapClick(e) {
    const areaId = getAreaId();
    if (tryMultiDriveCandidateClick?.(e)) return;
    if (tryMultiDriveConsistentClick?.(e)) return;
    if (tryMismatchCandidateClick?.(e)) return;

    if (selectionState.evidenceVisible && handleObservationEvidenceClick(map, e, { clearOsmRoadHighlight })) {
      hideSelectionCard();
      clearSectionHighlight(map);
      return true;
    }

    if (tryMultiDriveDiagnosticClick?.(e)) return;
    if (tryMismatchNonCandidateClick?.(e)) return;

    if (areaId === COMPARISON_AREA) {
      const compHits = queryLineLayers(map, e.point, comparisonClickLayerIds());
      if (compHits.length) {
        const f = compHits[0];
        const props = { ...f.properties };
        const group = props.ui_group;
        clearObservationSelection(map);
        clearOsmRoadHighlight();
        clearSelectedRoadMarkers(map);
        highlightSection(map, f);

        if (group === 'proposed' && props.ui_actionable && !isDiagnosticObservationRoute()) {
          showMapSelectionCard('proposed', formatProposedHtml(props));
          bindProposedActions(map, areaId, props);
          return true;
        }
        if (group === 'proposed' && isDiagnosticObservationRoute()) {
          showMapSelectionCard(
            'diagnostic',
            '<p class="muted small">Proposed-change actions are disabled for diagnostic observation routes. The production active route is unchanged.</p>'
          );
          return true;
        }
        if (group === 'verified') {
          showMapSelectionCard('verified', `${formatVerifiedHtml(props)}<p class="muted small">Loading OSM vs selected route…</p>`);
          void appendOsmVsSelectedRouteBlock(formatVerifiedHtml(props), props.osm_id).then((html) =>
            showMapSelectionCard('verified', html)
          );
          return true;
        }
        if (group === 'diagnostic') {
          showMapSelectionCard('diagnostic', `${formatDiagnosticHtml(props)}<p class="muted small">Loading OSM vs selected route…</p>`);
          void appendOsmVsSelectedRouteBlock(formatDiagnosticHtml(props), props.osm_id).then((html) =>
            showMapSelectionCard('diagnostic', html)
          );
          return true;
        }
      }
    }

    const roads = map.queryRenderedFeatures(observationClickQueryBox(e.point, LINE_HIT), {
      layers: DETAILED_FILL_LAYER_IDS,
    });
    if (roads.length) {
      clearObservationSelection(map);
      clearSectionHighlight(map);
      const f = roads[0];
      const props = f.properties || {};
      highlightSelectedRoad(map, props, f.geometry);
      const oneway = String(props.oneway || '').toLowerCase();
      const onewayNote =
        oneway === 'yes' || oneway === '1' || oneway === 'true'
          ? '<p class="oneway-note">One-way road (direction follows OSM geometry).</p>'
          : '';
      showMapSelectionCard('road', `${onewayNote}<p class="muted small">Loading lane baseline…</p>`);
      void (async () => {
        const derived = await fetchDerivedRoadInfo(areaId, props.osm_id);
        const comparison = await fetchOsmVsSelectedRouteComparison(
          props.osm_id,
          getObservationRouteKey()
        );
        const osmBlock = formatOsmVsSelectedRouteBlock(comparison);
        showMapSelectionCard('road', `${onewayNote}${renderSelectedRoadHtml(props, derived)}${osmBlock}`);
        const info = el('road-info');
        if (info) {
          info.classList.remove('muted');
          info.textContent = formatSelectedRoadCard(props, derived);
        }
      })();
      return true;
    }

    clearAllSelections(map, { clearOsmRoadHighlight });
    return false;
  };
}

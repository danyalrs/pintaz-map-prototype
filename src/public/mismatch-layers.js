import { HIGHLIGHT_LAYER_ID } from './detailed-road-layers.js?v=osm-turn-lane-guidance-v2';
import {
  boundsForFeatures,
  fitOptionsForSectionLength,
} from '/lib/comparison-fit-bounds.js?v=osm-turn-lane-guidance-v2';
import { formatDistanceMetres, formatConfidence, formatCount } from '/lib/format-display.js?v=osm-turn-lane-guidance-v2';
import { formatMismatchDiagnosticCardHtml } from '/lib/mismatch-card-format.js?v=osm-turn-lane-guidance-v2';
import { MISMATCH_HIT_WIDTH, MISMATCH_VISIBLE_LINE_WIDTH } from '/lib/mismatch-layer-constants.js?v=osm-turn-lane-guidance-v2';

export const MISMATCH_SOURCE_ID = 'pintaz-mismatch-sections';
export const MISMATCH_HIGHLIGHT_SOURCE_ID = 'pintaz-mismatch-highlight';

export { MISMATCH_HIT_WIDTH, MISMATCH_VISIBLE_LINE_WIDTH } from '/lib/mismatch-layer-constants.js?v=osm-turn-lane-guidance-v2';
export const MISMATCH_AREA = 'bukit-bintang-imbi';
const LINE_HIT = 8;
const HIT_WIDTH = MISMATCH_HIT_WIDTH;

export const MISMATCH_LAYER = {
  consistentCasing: 'pintaz-mismatch-consistent-casing',
  consistentLine: 'pintaz-mismatch-consistent-line',
  consistentHit: 'pintaz-mismatch-consistent-hit',
  candidatePendingCasing: 'pintaz-mismatch-candidate-pending-casing',
  candidatePendingLine: 'pintaz-mismatch-candidate-pending-line',
  candidatePendingHit: 'pintaz-mismatch-candidate-pending-hit',
  candidateAcceptedCasing: 'pintaz-mismatch-candidate-accepted-casing',
  candidateAcceptedLine: 'pintaz-mismatch-candidate-accepted-line',
  candidateAcceptedHit: 'pintaz-mismatch-candidate-accepted-hit',
  candidateRejectedCasing: 'pintaz-mismatch-candidate-rejected-casing',
  candidateRejectedLine: 'pintaz-mismatch-candidate-rejected-line',
  candidateRejectedHit: 'pintaz-mismatch-candidate-rejected-hit',
  diagnosticLine: 'pintaz-mismatch-diagnostic-line',
  diagnosticHit: 'pintaz-mismatch-diagnostic-hit',
};

const state = {
  loaded: false,
  features: [],
  showResults: true,
  showConsistent: true,
  showDiagnostics: false,
  uiCounts: null,
  selectedId: null,
};

function el(id) {
  return document.getElementById(id);
}

function queryBox(point, pad) {
  return [
    [point.x - pad, point.y - pad],
    [point.x + pad, point.y + pad],
  ];
}

export function getMismatchCandidateClickLayerIds() {
  if (!state.showResults) return [];
  return [
    MISMATCH_LAYER.candidatePendingHit,
    MISMATCH_LAYER.candidateAcceptedHit,
    MISMATCH_LAYER.candidateRejectedHit,
  ].filter((id) => id);
}

export function getMismatchNonCandidateClickLayerIds() {
  const ids = [];
  if (state.showConsistent) ids.push(MISMATCH_LAYER.consistentHit);
  if (state.showDiagnostics) ids.push(MISMATCH_LAYER.diagnosticHit);
  return ids.filter((id) => id);
}

export function getMismatchClickLayerIds() {
  return [...getMismatchCandidateClickLayerIds(), ...getMismatchNonCandidateClickLayerIds()];
}

export function getMismatchHitLayerIds() {
  return Object.values(MISMATCH_LAYER).filter((id) => id.includes('Hit'));
}

export function repositionMismatchHitLayers(map) {
  if (!map) return;
  for (const id of getMismatchHitLayerIds()) {
    if (map.getLayer(id)) {
      map.moveLayer(id);
    }
  }
}

export function ensureMismatchLayers(map) {
  if (!map || map.getSource(MISMATCH_SOURCE_ID)) return;
  map.addSource(MISMATCH_SOURCE_ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addSource(MISMATCH_HIGHLIGHT_SOURCE_ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  const before = HIGHLIGHT_LAYER_ID;
  const addLine = (def) => {
    if (!map.getLayer(def.id)) map.addLayer(def, before);
  };
  const addHit = (def) => {
    if (!map.getLayer(def.id)) map.addLayer(def);
  };
  addLine({
    id: MISMATCH_LAYER.diagnosticLine,
    type: 'line',
    source: MISMATCH_SOURCE_ID,
    filter: ['==', ['get', 'ui_group'], 'diagnostic'],
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
    paint: {
      'line-color': '#94a3b8',
      'line-width': MISMATCH_VISIBLE_LINE_WIDTH,
      'line-dasharray': [2, 2],
      'line-opacity': 0.7,
    },
  });
  addHit({
    id: MISMATCH_LAYER.diagnosticHit,
    type: 'line',
    source: MISMATCH_SOURCE_ID,
    filter: ['==', ['get', 'ui_group'], 'diagnostic'],
    layout: { visibility: 'none' },
    paint: { 'line-color': '#94a3b8', 'line-width': HIT_WIDTH, 'line-opacity': 0.01 },
  });
  const consistent = (id, width, opacity) => ({
    id,
    type: 'line',
    source: MISMATCH_SOURCE_ID,
    filter: ['==', ['get', 'ui_group'], 'consistent'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#14b8a6', 'line-width': width, 'line-opacity': opacity },
  });
  addLine(consistent(MISMATCH_LAYER.consistentCasing, 9, 0.85));
  addLine(consistent(MISMATCH_LAYER.consistentLine, 6, 0.95));
  addHit({
    id: MISMATCH_LAYER.consistentHit,
    type: 'line',
    source: MISMATCH_SOURCE_ID,
    filter: ['==', ['get', 'ui_group'], 'consistent'],
    paint: { 'line-color': '#14b8a6', 'line-width': HIT_WIDTH, 'line-opacity': 0.01 },
  });
  const cand = (id, stateName, color, width) => ({
    id,
    type: 'line',
    source: MISMATCH_SOURCE_ID,
    filter: [
      'all',
      ['==', ['get', 'ui_group'], 'candidate'],
      ['==', ['get', 'candidate_state'], stateName],
    ],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': width, 'line-opacity': 0.95 },
  });
  addLine(cand(MISMATCH_LAYER.candidatePendingCasing, 'pending', '#f59e0b', 9));
  addLine(cand(MISMATCH_LAYER.candidatePendingLine, 'pending', '#fbbf24', 6));
  addHit(cand(MISMATCH_LAYER.candidatePendingHit, 'pending', '#fbbf24', HIT_WIDTH));
  addLine(cand(MISMATCH_LAYER.candidateAcceptedCasing, 'accepted', '#16a34a', 9));
  addLine(cand(MISMATCH_LAYER.candidateAcceptedLine, 'accepted', '#22c55e', 6));
  addHit(cand(MISMATCH_LAYER.candidateAcceptedHit, 'accepted', '#22c55e', HIT_WIDTH));
  addLine(cand(MISMATCH_LAYER.candidateRejectedCasing, 'rejected', '#dc2626', 9));
  addLine(cand(MISMATCH_LAYER.candidateRejectedLine, 'rejected', '#ef4444', 6));
  addHit(cand(MISMATCH_LAYER.candidateRejectedHit, 'rejected', '#ef4444', HIT_WIDTH));
  repositionMismatchHitLayers(map);
}

function applyVisibility(map) {
  const vis = (id, on) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  };
  const showCand = state.showResults;
  const showCons = state.showConsistent;
  const showDiag = state.showDiagnostics;
  for (const id of Object.values(MISMATCH_LAYER)) {
    if (id.includes('candidate')) vis(id, showCand);
    else if (id.includes('consistent')) vis(id, showCons);
    else vis(id, showDiag);
  }
}

function updateCounts(ui) {
  if (!ui) return;
  const set = (id, v) => {
    const n = el(id);
    if (n) n.textContent = String(v ?? 0);
  };
  set('mismatch-count-evaluated', ui.evaluated);
  set('mismatch-count-locally-usable', ui.locally_usable);
  set('mismatch-count-support-eligible', ui.support_eligible_either);
  set('mismatch-count-review', ui.review_candidates);
  set('mismatch-count-consistent', ui.consistent);
  set('mismatch-count-lane', ui.lane_count_candidates);
  set('mismatch-count-centerline', ui.centerline_candidates);
  set('mismatch-count-width', ui.display_width_candidates);
  set('mismatch-count-metadata', ui.missing_metadata_candidates);
  set('mismatch-count-insufficient', ui.insufficient);
  set('mismatch-count-ambiguous', ui.ambiguous);
  set('mismatch-count-unsupported', ui.unsupported);
  set('mismatch-count-not-evaluated', ui.not_evaluated);
  const gateBox = el('mismatch-gate-reasons');
  const gateList = el('mismatch-gate-reason-list');
  const gates = ui.gate_reason_counts || {};
  const top = Object.entries(gates).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (gateBox && gateList) {
    if (!top.length) {
      gateBox.classList.add('hidden');
      gateList.innerHTML = '';
    } else {
      gateBox.classList.remove('hidden');
      gateList.innerHTML = top.map(([k, v]) => `<li>${k}: ${v}</li>`).join('');
    }
  }
  const zeroHint = el('mismatch-zero-candidates-hint');
  const actionable =
    (ui.lane_count_candidates || 0) +
    (ui.centerline_candidates || 0) +
    (ui.display_width_candidates || 0) +
    (ui.missing_metadata_candidates || 0);
  if (zeroHint) zeroHint.classList.toggle('hidden', actionable > 0);
}

export function updateMismatchPanel(areaId) {
  const noArea = el('mismatch-no-area');
  const body = el('mismatch-body');
  if (areaId !== MISMATCH_AREA) {
    noArea?.classList.remove('hidden');
    body?.classList.add('hidden');
    return;
  }
  noArea?.classList.add('hidden');
  body?.classList.remove('hidden');
  updateCounts(state.uiCounts);
}

export async function loadMismatchForArea(map, areaId) {
  updateMismatchPanel(areaId);
  if (areaId !== MISMATCH_AREA) {
    state.loaded = false;
    state.features = [];
    if (map?.getSource(MISMATCH_SOURCE_ID)) {
      map.getSource(MISMATCH_SOURCE_ID).setData({ type: 'FeatureCollection', features: [] });
    }
    return;
  }
  try {
    const sum = await fetch(`/api/mismatch/v1/${areaId}/summary`).then((r) => (r.ok ? r.json() : null));
    state.uiCounts = sum?.manifest?.ui_counts ?? null;
    const geo = await fetch(`/api/mismatch/v1/${areaId}/sections.geojson`).then((r) => (r.ok ? r.json() : null));
    ensureMismatchLayers(map);
    state.features = geo?.features || [];
    map.getSource(MISMATCH_SOURCE_ID).setData(geo || { type: 'FeatureCollection', features: [] });
    state.loaded = true;
    applyVisibility(map);
    repositionMismatchHitLayers(map);
    updateMismatchPanel(areaId);
  } catch {
    state.loaded = false;
  }
}

export function clearMismatchHighlight(map) {
  state.selectedId = null;
  if (map?.getSource(MISMATCH_HIGHLIGHT_SOURCE_ID)) {
    map.getSource(MISMATCH_HIGHLIGHT_SOURCE_ID).setData({ type: 'FeatureCollection', features: [] });
  }
}

export function highlightMismatchSection(map, feature) {
  state.selectedId = feature.properties?.candidate_id;
  if (!map.getSource(MISMATCH_HIGHLIGHT_SOURCE_ID)) return;
  map.getSource(MISMATCH_HIGHLIGHT_SOURCE_ID).setData({
    type: 'FeatureCollection',
    features: [feature],
  });
}

function formatCandidateHtml(props) {
  const widthNote =
    props.classification === 'possible_display_width_difference'
      ? '<p class="partial-warning">Compared against lane-count display width; OSM has no measured width tag.</p>'
      : '';
  const metaNote =
    props.classification === 'osm_lane_metadata_missing'
      ? '<p class="partial-warning">Server-derived review candidate; OSM lane count is absent.</p>'
      : '';
  const rows = [
    ['Classification', props.classification],
    ['OSM road name', props.name || 'Not provided'],
    ['OSM ID', props.osm_id],
    ['Section length', formatDistanceMetres(props.section_length_m)],
    ['OSM lane count', props.osm_lane_count ?? 'Not provided'],
    ['Lane-count source', props.lane_count_source || 'Not provided'],
    ['Display width', formatDistanceMetres(props.derived_display_width_m)],
    ['Vehicle frames', formatCount(props.vehicle_frames)],
    ['Both-edge frames', formatCount(props.frames_with_both_edges)],
    ['Centre shift', formatDistanceMetres(props.median_common_centre_shift_m)],
    ['Observed span', formatDistanceMetres(props.median_observed_span_m)],
    ['P90 divider residual', formatDistanceMetres(props.median_p90_shifted_divider_residual_m)],
    ['Confidence', formatConfidence(props.confidence)],
    ['Sensitivity stable', props.sensitivity_stable ? 'Yes' : 'No'],
  ];
  const dl = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  return `${widthNote}${metaNote}<p class="partial-warning">Partial page 1 corridor only.</p>
    <dl class="status-dl compact-dl">${dl}</dl>
    <div class="btn-row"><button type="button" id="mismatch-accept-btn" class="btn btn-primary">Accept</button>
    <button type="button" id="mismatch-reject-btn" class="btn btn-secondary">Reject</button></div>`;
}

function formatVerifiedLaneHtml(props) {
  const dl = [
    ['Classification', props.classification],
    ['OSM ID', props.osm_id],
    ['Observed span', formatDistanceMetres(props.observed_along_span_m)],
    ['Evaluation scope', props.evaluation_scope],
    ['Vehicle frames', formatCount(props.vehicle_frames)],
    ['Lane observations', formatCount(props.lane_observations)],
    ['Edge observations', formatCount(props.edge_observations)],
    ['Confidence', formatConfidence(props.confidence)],
    ['Sensitivity stable', props.sensitivity_stable ? 'Yes' : 'No'],
  ]
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
    .join('');
  return `<p class="verified-banner">No map change suggested</p><dl class="status-dl compact-dl">${dl}</dl>`;
}

export function formatMismatchSelectionCard(props) {
  if (props.ui_group === 'candidate' && props.ui_actionable) {
    return { mode: 'mismatch-candidate', title: 'Proposed map update', html: formatCandidateHtml(props) };
  }
  if (props.ui_group === 'consistent') {
    return { mode: 'mismatch-verified', title: 'Verified lane section', html: formatVerifiedLaneHtml(props) };
  }
  return { mode: 'mismatch-diagnostic', title: 'Mismatch diagnostic', html: formatMismatchDiagnosticCardHtml(props) };
}

export function initMismatchUi(map, { getAreaId, onSelectionCard }) {
  el('mismatch-results-toggle')?.addEventListener('change', (e) => {
    state.showResults = e.target.checked;
    applyVisibility(map);
  });
  el('mismatch-consistent-toggle')?.addEventListener('change', (e) => {
    state.showConsistent = e.target.checked;
    applyVisibility(map);
  });
  el('mismatch-diagnostics-toggle')?.addEventListener('change', (e) => {
    state.showDiagnostics = e.target.checked;
    applyVisibility(map);
    repositionMismatchHitLayers(map);
  });

  const canvas = map.getCanvas?.();
  const setPointer = (on) => {
    if (canvas) canvas.style.cursor = on ? 'pointer' : '';
  };
  map.on('mousemove', (e) => {
    if (!state.showDiagnostics || !state.loaded || getAreaId() !== MISMATCH_AREA) {
      setPointer(false);
      return;
    }
    const layer = MISMATCH_LAYER.diagnosticHit;
    if (!map.getLayer(layer) || map.getLayoutProperty(layer, 'visibility') === 'none') {
      setPointer(false);
      return;
    }
    const hits = map.queryRenderedFeatures(queryBox(e.point, LINE_HIT), { layers: [layer] });
    setPointer(hits.length > 0);
  });
  map.on('mouseleave', () => setPointer(false));
  el('mismatch-zoom-candidates')?.addEventListener('click', () => {
    const feats = state.features.filter((f) => f.properties?.ui_group === 'candidate');
    const bounds = boundsForFeatures(feats);
    if (bounds) map.fitBounds(bounds, fitOptionsForSectionLength(80));
  });
  el('mismatch-reset-decisions')?.addEventListener('click', async () => {
    const areaId = getAreaId();
    await fetch(`/api/mismatch/v1/${areaId}/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    await loadMismatchForArea(map, areaId);
  });

  function openMismatchFeature(mapRef, feature, { clearOthers }) {
    const props = { ...feature.properties };
    clearOthers?.();
    highlightMismatchSection(mapRef, feature);
    const card = formatMismatchSelectionCard(props);
    onSelectionCard?.(card.mode, card.html, card.title, props);
    if (card.mode === 'mismatch-candidate') {
      el('mismatch-accept-btn')?.addEventListener('click', async () => {
        await fetch(`/api/mismatch/v1/${MISMATCH_AREA}/candidate/${props.candidate_id}/decision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: 'accepted' }),
        });
        await loadMismatchForArea(mapRef, MISMATCH_AREA);
      });
      el('mismatch-reject-btn')?.addEventListener('click', async () => {
        await fetch(`/api/mismatch/v1/${MISMATCH_AREA}/candidate/${props.candidate_id}/decision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: 'rejected' }),
        });
        await loadMismatchForArea(mapRef, MISMATCH_AREA);
      });
    }
    return true;
  }

  function queryMismatchHits(mapRef, e, layerIds) {
    const layers = layerIds.filter((id) => mapRef.getLayer(id));
    if (!layers.length) return [];
    return mapRef.queryRenderedFeatures(queryBox(e.point, Math.max(LINE_HIT, Math.floor(HIT_WIDTH / 2))), {
      layers,
    });
  }

  return {
    handleMismatchCandidateClick(mapRef, e, { clearOthers }) {
      if (!state.loaded || getAreaId() !== MISMATCH_AREA) return false;
      const hits = queryMismatchHits(mapRef, e, getMismatchCandidateClickLayerIds());
      const actionable = hits.find(
        (f) => f.properties?.ui_group === 'candidate' && f.properties?.ui_actionable
      );
      if (!actionable) return false;
      return openMismatchFeature(mapRef, actionable, { clearOthers });
    },
    handleMismatchNonCandidateClick(mapRef, e, { clearOthers }) {
      if (!state.loaded || getAreaId() !== MISMATCH_AREA) return false;
      const hits = queryMismatchHits(mapRef, e, getMismatchNonCandidateClickLayerIds());
      if (!hits.length) return false;
      return openMismatchFeature(mapRef, hits[0], { clearOthers });
    },
    clearMismatchHighlight: () => clearMismatchHighlight(map),
    clearMismatchLayers(mapRef) {
      state.loaded = false;
      state.features = [];
      if (mapRef?.getSource(MISMATCH_SOURCE_ID)) {
        mapRef.getSource(MISMATCH_SOURCE_ID).setData({ type: 'FeatureCollection', features: [] });
      }
      clearMismatchHighlight(mapRef);
    },
  };
}

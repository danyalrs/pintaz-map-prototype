import { boundsForFeatures, fitOptionsForSectionLength } from '/lib/comparison-fit-bounds.js?v=local-route-explorer-v1';
import { formatConfidence, formatCount, formatDistanceMetres } from '/lib/format-display.js?v=local-route-explorer-v1';

const CONSISTENT_CLASS = 'consistent_with_osm_lanes';

function isSingleDriveConsistentSection(props) {
  if (!props || props.mismatch_class !== CONSISTENT_CLASS) return false;
  const supporting = (props.per_drive_evidence || []).filter(
    (e) => e.classification === CONSISTENT_CLASS && e.support_eligible_centreline
  );
  return supporting.length === 1;
}

export const MULTI_DRIVE_SOURCE_ID = 'pintaz-multi-drive-sections';
export const MULTI_DRIVE_HIGHLIGHT_SOURCE_ID = 'pintaz-multi-drive-highlight';
export const MULTI_DRIVE_AREA = 'bukit-bintang-imbi';

const LAYER = {
  consistentLine: 'pintaz-md-consistent-line',
  candidatePendingLine: 'pintaz-md-candidate-pending-line',
  candidateAcceptedLine: 'pintaz-md-candidate-accepted-line',
  candidateRejectedLine: 'pintaz-md-candidate-rejected-line',
  singleLine: 'pintaz-md-single-line',
  singleConsistentLine: 'pintaz-md-single-consistent-line',
  conflictLine: 'pintaz-md-conflict-line',
  diagLine: 'pintaz-md-diag-line',
};

function hitId(lineId) {
  return `${lineId}-hit`;
}

const state = {
  loaded: false,
  features: [],
  summary: null,
  showComparison: true,
  showSingleDrive: false,
  showDiagnostics: false,
};

function el(id) {
  return document.getElementById(id);
}

function queryBox(point, pad) {
  return [[point.x - pad, point.y - pad], [point.x + pad, point.y + pad]];
}

export function getMultiDriveCandidateHitLayers() {
  if (!state.showComparison) return [];
  return [
    hitId(LAYER.candidatePendingLine),
    hitId(LAYER.candidateAcceptedLine),
    hitId(LAYER.candidateRejectedLine),
  ];
}

export function getMultiDriveNonCandidateHitLayers(evidenceVisible) {
  const ids = [];
  if (state.showComparison) ids.push(hitId(LAYER.consistentLine));
  if (state.showSingleDrive) {
    ids.push(hitId(LAYER.singleLine), hitId(LAYER.singleConsistentLine));
  }
  if (state.showDiagnostics) ids.push(hitId(LAYER.conflictLine), hitId(LAYER.diagLine));
  if (evidenceVisible && state.showDiagnostics) {
    return ids.filter((id) => id !== hitId(LAYER.diagLine));
  }
  return ids;
}

export function ensureMultiDriveLayers(map) {
  if (!map || map.getSource(MULTI_DRIVE_SOURCE_ID)) return;
  map.addSource(MULTI_DRIVE_SOURCE_ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addSource(MULTI_DRIVE_HIGHLIGHT_SOURCE_ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  const add = (id, color, width, dash, filter) => {
    map.addLayer({
      id,
      type: 'line',
      source: MULTI_DRIVE_SOURCE_ID,
      filter,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': color,
        'line-width': width,
        'line-opacity': 0.9,
        ...(dash ? { 'line-dasharray': dash } : {}),
      },
    });
    map.addLayer({
      id: `${id}-hit`,
      type: 'line',
      source: MULTI_DRIVE_SOURCE_ID,
      filter,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': 18, 'line-opacity': 0.01 },
    });
  };
  add(LAYER.consistentLine, '#14b8a6', 5, null, ['==', ['get', 'md_layer'], 'consistent']);
  add(LAYER.candidatePendingLine, '#f59e0b', 6, null, ['all', ['==', ['get', 'md_layer'], 'candidate'], ['==', ['get', 'candidate_state'], 'pending']]);
  add(LAYER.candidateAcceptedLine, '#16a34a', 6, null, ['all', ['==', ['get', 'md_layer'], 'candidate'], ['==', ['get', 'candidate_state'], 'accepted']]);
  add(LAYER.candidateRejectedLine, '#dc2626', 6, null, ['all', ['==', ['get', 'md_layer'], 'candidate'], ['==', ['get', 'candidate_state'], 'rejected']]);
  add(LAYER.singleLine, '#a855f7', 4, [2, 2], ['==', ['get', 'md_layer'], 'single']);
  add(LAYER.singleConsistentLine, '#2dd4bf', 5, null, ['==', ['get', 'md_layer'], 'single-consistent']);
  add(LAYER.conflictLine, '#ea580c', 4, [2, 2], ['==', ['get', 'md_layer'], 'conflict']);
  add(LAYER.diagLine, '#94a3b8', 3, [2, 2], ['==', ['get', 'md_layer'], 'diag']);
}

function decorateFeature(f) {
  const st = f.properties?.aggregate_state;
  let md_layer = 'diag';
  if (isSingleDriveConsistentSection(f.properties)) md_layer = 'single-consistent';
  else if (st === 'consistent_across_drives') md_layer = 'consistent';
  else if (st === 'possible_mismatch_supported_by_multiple_drives') md_layer = 'candidate';
  else if (st === 'single_drive_signal_only') md_layer = 'single';
  else if (st === 'conflicting_drive_evidence') md_layer = 'conflict';
  return { ...f, properties: { ...f.properties, md_layer } };
}

function applyVisibility(map) {
  if (!map) return;
  const vis = (on) => (state.showComparison ? 'visible' : 'none');
  for (const id of Object.values(LAYER)) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis(true));
    if (map.getLayer(hitId(id))) map.setLayoutProperty(hitId(id), 'visibility', vis(true));
  }
  const singleVis = state.showSingleDrive ? 'visible' : 'none';
  for (const base of [LAYER.singleLine, LAYER.singleConsistentLine]) {
    if (map.getLayer(base)) map.setLayoutProperty(base, 'visibility', singleVis);
    if (map.getLayer(hitId(base))) map.setLayoutProperty(hitId(base), 'visibility', singleVis);
  }
  const diagVis = state.showDiagnostics ? 'visible' : 'none';
  for (const base of [LAYER.conflictLine, LAYER.diagLine]) {
    if (map.getLayer(base)) map.setLayoutProperty(base, 'visibility', diagVis);
    if (map.getLayer(hitId(base))) map.setLayoutProperty(hitId(base), 'visibility', diagVis);
  }
}

function updatePanel() {
  const s = state.summary || {};
  const c = s.aggregate_state_counts || {};
  const set = (id, v) => {
    const n = el(id);
    if (n) n.textContent = String(v ?? 0);
  };
  set('md-count-drives', s.drives_analysed);
  set('md-count-dongles', s.distinct_dongle_groups);
  set('md-count-osm', s.osm_roads_evaluated);
  const pilotTotals = (s.pilot_scope?.per_drive || []).reduce(
    (acc, d) => ({
      total: acc.total + (d.total_route_poses || 0),
      pilot: acc.pilot + (d.pilot_poses || 0),
      excluded: acc.excluded + (d.excluded_outside_pilot || 0),
      matched: acc.matched + (d.matched_pilot_poses || 0),
    }),
    { total: 0, pilot: 0, excluded: 0, matched: 0 }
  );
  set('md-count-total-poses', pilotTotals.total);
  set('md-count-pilot-poses', pilotTotals.pilot);
  set('md-count-matched-pilot', pilotTotals.matched);
  set('md-count-excluded-pilot', pilotTotals.excluded);
  set('md-count-support-centreline', s.support_eligible_totals?.support_eligible_centreline ?? 0);
  set('md-count-support-lane-edge', s.support_eligible_totals?.support_eligible_lane_edge ?? 0);
  set('md-count-single-consistent', s.single_drive_consistent_sections ?? 0);
  const failList = el('md-top-failures');
  if (failList) {
    const tops = s.ui_diagnostics?.top_failure_reasons || [];
    failList.innerHTML = tops.length
      ? tops.map((t) => `<li>${t.reason}: ${t.count}</li>`).join('')
      : '<li class="muted">No gate failures recorded</li>';
  }
  set('md-count-consistent', c.consistent_across_drives ?? s.consistent_across_drives);
  set('md-count-candidates', s.multi_drive_candidates);
  set('md-count-single', s.single_drive_signals);
  set('md-count-conflicts', c.conflicting_drive_evidence ?? s.conflicts);
  set('md-count-insufficient', (c.insufficient_combined_evidence || 0) + (c.not_evaluated || 0));
}

export async function loadMultiDriveForArea(map, areaId) {
  const body = el('multi-drive-body');
  const noArea = el('multi-drive-no-area');
  if (areaId !== MULTI_DRIVE_AREA) {
    noArea?.classList.remove('hidden');
    body?.classList.add('hidden');
    state.loaded = false;
    state.features = [];
    if (map?.getSource(MULTI_DRIVE_SOURCE_ID)) {
      map.getSource(MULTI_DRIVE_SOURCE_ID).setData({ type: 'FeatureCollection', features: [] });
    }
    return;
  }
  noArea?.classList.add('hidden');
  body?.classList.remove('hidden');
  try {
    const sum = await fetch('/api/multi-drive-mismatch/v1/bukit-bintang-imbi/summary').then((r) =>
      r.ok ? r.json() : null
    );
    state.summary = sum?.manifest ?? null;
    const sections = await fetch('/api/multi-drive-mismatch/v1/bukit-bintang-imbi/sections.geojson').then((r) =>
      r.ok ? r.json() : null
    );
    const candidates = await fetch('/api/multi-drive-mismatch/v1/bukit-bintang-imbi/candidates.geojson').then((r) =>
      r.ok ? r.json() : null
    );
    const candMap = new Map((candidates?.features || []).map((f) => [f.properties?.aggregate_id, f.properties]));
    const feats = (sections?.features || []).map((f) => {
      const cid = f.properties?.aggregate_id;
      const cand = candMap.get(cid);
      return decorateFeature({
        ...f,
        properties: { ...f.properties, candidate_state: cand?.candidate_state || null },
      });
    });
    ensureMultiDriveLayers(map);
    state.features = feats;
    map.getSource(MULTI_DRIVE_SOURCE_ID).setData({ type: 'FeatureCollection', features: feats });
    state.loaded = true;
    applyVisibility(map);
    updatePanel();
  } catch {
    state.loaded = false;
  }
}

function formatCardHtml(props) {
  const singleConsistent = isSingleDriveConsistentSection(props);
  const supporting = (props.per_drive_evidence || []).filter(
    (d) => d.classification === CONSISTENT_CLASS && d.support_eligible_centreline
  );
  const drives = (props.per_drive_evidence || [])
    .map(
      (d) =>
        `<li>${d.redacted_drive_ref} (${d.dongle_group}): ${d.classification}, frames ${formatCount(d.vehicle_frames)}</li>`
    )
    .join('');
  const actionable = props.aggregate_state === 'possible_mismatch_supported_by_multiple_drives';
  const buttons = actionable
    ? `<div class="btn-row"><button type="button" id="md-accept-btn" class="btn btn-primary">Accept</button>
    <button type="button" id="md-reject-btn" class="btn btn-secondary">Reject</button></div>`
    : '';
  if (singleConsistent) {
    const ref = supporting[0]?.redacted_drive_ref || '—';
    const group = supporting[0]?.dongle_group || '—';
    return `<p class="muted small">One drive is consistent with OSM in one supported section. No cross-drive conclusion.</p>
    <dl class="status-dl compact-dl">
    <dt>Conclusion</dt><dd>Single-drive consistent with OSM (centreline)</dd>
    <dt>Supporting drive</dt><dd>${ref} (${group})</dd>
    <dt>OSM road</dt><dd>${props.osm_id}</dd>
    <dt>Map change suggested</dt><dd>No</dd>
    </dl>`;
  }
  const gateList = (props.per_drive_evidence || [])
    .flatMap((d) => (d.classification ? [`${d.redacted_drive_ref}: ${d.classification}`] : []))
    .join('<br>');
  const stateLabel =
    props.aggregate_state === 'consistent_across_drives'
      ? 'Consistent across drives'
      : props.aggregate_state;
  return `<dl class="status-dl compact-dl">
    <dt>OSM road</dt><dd>${props.osm_id}</dd>
    <dt>Aggregate state</dt><dd>${stateLabel}</dd>
    <dt>Per-drive class</dt><dd>${gateList || '—'}</dd>
    <dt>Distinct dongle groups</dt><dd>${(props.distinct_dongle_groups || []).join(', ')}</dd>
    <dt>Support drives</dt><dd>${formatCount(props.support_drive_count)}</dd>
    <dt>Confidence</dt><dd>${formatConfidence(props.confidence)}</dd>
    </dl>
    <ul class="compact-list">${drives}</ul>
    ${buttons}`;
}

export function initMultiDriveUi(map, { getAreaId, onSelectionCard }) {
  el('md-toggle-comparison')?.addEventListener('change', (e) => {
    state.showComparison = e.target.checked;
    applyVisibility(map);
  });
  el('md-toggle-single')?.addEventListener('change', (e) => {
    state.showSingleDrive = e.target.checked;
    applyVisibility(map);
  });
  el('md-toggle-diagnostics')?.addEventListener('change', (e) => {
    state.showDiagnostics = e.target.checked;
    applyVisibility(map);
  });
  el('md-zoom-evidence')?.addEventListener('click', () => {
    const feats = state.features.filter((f) =>
      ['candidate', 'consistent', 'single-consistent'].includes(f.properties?.md_layer)
    );
    const bounds = boundsForFeatures(feats);
    if (bounds) map.fitBounds(bounds, fitOptionsForSectionLength(120));
  });
  el('md-reset-decisions')?.addEventListener('click', async () => {
    await fetch('/api/multi-drive-mismatch/v1/bukit-bintang-imbi/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    await loadMultiDriveForArea(map, getAreaId());
  });

  function openFeature(feature, { clearOthers }) {
    clearOthers?.();
    if (map.getSource(MULTI_DRIVE_HIGHLIGHT_SOURCE_ID)) {
      map.getSource(MULTI_DRIVE_HIGHLIGHT_SOURCE_ID).setData({
        type: 'FeatureCollection',
        features: [feature],
      });
    }
    const props = feature.properties;
    onSelectionCard?.('multi-drive', formatCardHtml(props), 'Multi-drive OSM comparison');
    if (props.aggregate_state === 'possible_mismatch_supported_by_multiple_drives') {
      const id = props.aggregate_id;
      el('md-accept-btn')?.addEventListener('click', async () => {
        await fetch(`/api/multi-drive-mismatch/v1/bukit-bintang-imbi/candidate/${id}/decision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: 'accepted' }),
        });
        await loadMultiDriveForArea(map, getAreaId());
      });
      el('md-reject-btn')?.addEventListener('click', async () => {
        await fetch(`/api/multi-drive-mismatch/v1/bukit-bintang-imbi/candidate/${id}/decision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: 'rejected' }),
        });
        await loadMultiDriveForArea(map, getAreaId());
      });
    }
  }

  function tryClick(mapRef, e, layerIds, { clearOthers }) {
    if (!state.loaded || getAreaId() !== MULTI_DRIVE_AREA) return false;
    const hits = mapRef.queryRenderedFeatures(queryBox(e.point, 10), { layers: layerIds.filter((id) => mapRef.getLayer(id)) });
    if (!hits.length) return false;
    const id = hits[0].properties?.aggregate_id;
    const feature = state.features.find((f) => f.properties?.aggregate_id === id);
    if (!feature) return false;
    openFeature(feature, { clearOthers });
    return true;
  }

  return {
    handleCandidateClick: (e, opts) => tryClick(map, e, getMultiDriveCandidateHitLayers(), opts),
    handleConsistentClick: (e, opts) => tryClick(map, e, [hitId(LAYER.consistentLine)], opts),
    handleDiagnosticClick: (e, opts) => {
      const layers = [];
      if (state.showSingleDrive) {
        layers.push(hitId(LAYER.singleLine), hitId(LAYER.singleConsistentLine));
      }
      if (state.showDiagnostics) layers.push(hitId(LAYER.conflictLine), hitId(LAYER.diagLine));
      return tryClick(map, e, layers, opts);
    },
    clearHighlight: () => {
      if (map.getSource(MULTI_DRIVE_HIGHLIGHT_SOURCE_ID)) {
        map.getSource(MULTI_DRIVE_HIGHLIGHT_SOURCE_ID).setData({ type: 'FeatureCollection', features: [] });
      }
    },
  };
}

import {
  UPDATE_SOURCE_ID,
  updatePreviewLayerDefinitions,
  UPDATE_PREVIEW_AREA_ID,
} from '/lib/update-observation-info.js?v=osm-turn-lane-guidance-v2';
import { HIGHLIGHT_LAYER_ID } from './detailed-road-layers.js?v=osm-turn-lane-guidance-v2';
import {
  getSelectableObservationLayerIds,
  queryObservationFeaturesAtClick,
  pickTopObservationFeature,
  buildObservationPanelFields,
  renderObservationPanelHtml,
  SELECTION_SOURCE_ID,
  SELECTION_LAYER_ID,
  emptySelectionCollection,
  selectionFeatureForCoordinate,
  LAYER_KEY_BY_MAP_ID,
} from '/lib/update-preview-click.js?v=osm-turn-lane-guidance-v2';

import {
  getObservationRouteKey,
} from './observation-route-state.js?v=osm-turn-lane-guidance-v2';

const evidenceState = {
  geojson: null,
  visible: false,
  layerVisibility: {
    vehicle_pose: true,
    lane_point: true,
    edge_point: true,
    gps_point: true,
  },
  error: null,
  selected: null,
};

function el(id) {
  return document.getElementById(id);
}

function previewInteractionState() {
  return {
    visible: evidenceState.visible,
    layerVisibility: evidenceState.layerVisibility,
    areaId: window.__pintazAreaId?.() ?? null,
  };
}

function setObservationPanelDefault() {
  const panel = el('observation-info-panel');
  const content = el('observation-info');
  if (content) {
    content.textContent = 'Click a server observation on the map.';
    content.classList.add('muted');
  }
  if (panel) panel.classList.remove('observation-info--active');
}

function showObservationPanel(fields) {
  const panel = el('observation-info-panel');
  const content = el('observation-info');
  if (!content) return;
  content.classList.remove('muted');
  content.innerHTML = renderObservationPanelHtml(fields);
  if (panel) {
    panel.classList.add('observation-info--active');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

export function clearObservationSelection(map) {
  evidenceState.selected = null;
  setObservationPanelDefault();
  if (map?.getSource(SELECTION_SOURCE_ID)) {
    map.getSource(SELECTION_SOURCE_ID).setData(emptySelectionCollection());
  }
}

function applySelectionHighlight(map, feature) {
  if (!map?.getSource(SELECTION_SOURCE_ID) || !feature) return;
  const coords = feature.geometry?.coordinates;
  const layerId = feature.layer?.id;
  const layerKey = LAYER_KEY_BY_MAP_ID[layerId] || feature.properties?.layer;
  if (!coords || !layerKey) return;
  evidenceState.selected = { coords, layerKey };
  map.getSource(SELECTION_SOURCE_ID).setData({
    type: 'FeatureCollection',
    features: [selectionFeatureForCoordinate(coords, layerKey)],
  });
}

function applyLayerVisibility(map) {
  if (!map) return;
  for (const [layerKey, layerId] of Object.entries({
    vehicle_pose: 'pintaz-update-vehicle_pose',
    lane_point: 'pintaz-update-lane_point',
    edge_point: 'pintaz-update-edge_point',
    gps_point: 'pintaz-update-gps_point',
  })) {
    if (!map.getLayer(layerId)) continue;
    const show =
      evidenceState.visible &&
      evidenceState.layerVisibility[layerKey] &&
      (window.__pintazAreaId?.() ?? null) === UPDATE_PREVIEW_AREA_ID;
    map.setLayoutProperty(layerId, 'visibility', show ? 'visible' : 'none');
  }
}

export function ensureSelectionHighlightLayer(map) {
  if (!map || map.getSource(SELECTION_SOURCE_ID)) return;
  map.addSource(SELECTION_SOURCE_ID, {
    type: 'geojson',
    data: emptySelectionCollection(),
  });
  map.addLayer(
    {
      id: SELECTION_LAYER_ID,
      type: 'circle',
      source: SELECTION_SOURCE_ID,
      paint: {
        'circle-radius': 12,
        'circle-color': ['get', 'halo_color'],
        'circle-opacity': 0.28,
        'circle-stroke-width': 2.5,
        'circle-stroke-color': ['get', 'halo_color'],
        'circle-stroke-opacity': 0.95,
      },
    },
    HIGHLIGHT_LAYER_ID
  );
}

export function ensureObservationEvidenceLayers(map) {
  if (!map || map.getSource(UPDATE_SOURCE_ID)) return;
  map.addSource(UPDATE_SOURCE_ID, {
    type: 'geojson',
    data: evidenceState.geojson || { type: 'FeatureCollection', features: [] },
  });
  for (const layer of updatePreviewLayerDefinitions()) {
    map.addLayer(layer, HIGHLIGHT_LAYER_ID);
  }
  ensureSelectionHighlightLayer(map);
}

/**
 * Observation-first map click. Returns true if an observation consumed the click.
 */
export function handleObservationEvidenceClick(map, e, { clearOsmRoadHighlight } = {}) {
  const layerIds = getSelectableObservationLayerIds(map, previewInteractionState());
  const feats = queryObservationFeaturesAtClick(map, e.point, layerIds);
  const top = pickTopObservationFeature(feats);
  if (!top) return false;

  const coords = top.geometry?.coordinates;
  const props = top.properties || {};
  const fields = buildObservationPanelFields(props, coords);
  showObservationPanel(fields);
  applySelectionHighlight(map, top);
  clearOsmRoadHighlight?.();
  return true;
}

function observationHoverCursor(map, e) {
  const canvas = map?.getCanvas();
  if (!canvas) return;
  if (!evidenceState.visible) {
    canvas.style.cursor = '';
    return;
  }
  const layerIds = getSelectableObservationLayerIds(map, previewInteractionState());
  const feats = queryObservationFeaturesAtClick(map, e.point, layerIds);
  canvas.style.cursor = feats.length ? 'pointer' : '';
}

async function loadGeojson() {
  const routeKey = getObservationRouteKey();
  const res = await fetch(
    `/api/local-route-explorer/v1/routes/${encodeURIComponent(routeKey)}/observations.geojson`
  );
  if (!res.ok) throw new Error('Observation GeoJSON unavailable');
  evidenceState.geojson = await res.json();
}

export function invalidateObservationGeojsonCache() {
  evidenceState.geojson = null;
}

async function refreshFeatureCountDisplay() {
  const count = el('server-evidence-feature-count');
  if (!count) return;
  try {
    const res = await fetch(
      `/api/local-route-explorer/v1/routes/${encodeURIComponent(getObservationRouteKey())}/metrics`
    );
    if (!res.ok) {
      count.textContent = '—';
      return;
    }
    const data = await res.json();
    count.textContent =
      data?.metrics?.feature_total != null ? String(data.metrics.feature_total) : '—';
  } catch {
    count.textContent = '—';
  }
}

export function renderServerEvidencePanel() {
  const areaId = window.__pintazAreaId?.() ?? null;
  const noArea = el('server-evidence-no-area');
  const body = el('server-evidence-body');
  const toggle = el('server-evidence-toggle');
  if (areaId !== UPDATE_PREVIEW_AREA_ID) {
    noArea?.classList.remove('hidden');
    body?.classList.add('hidden');
    if (toggle) {
      toggle.checked = false;
      toggle.disabled = true;
    }
    return;
  }
  noArea?.classList.add('hidden');
  body?.classList.remove('hidden');
  if (toggle) toggle.disabled = false;
  const loaded = el('server-evidence-loaded');
  if (loaded) {
    loaded.textContent = evidenceState.geojson ? 'Observation file loaded' : 'Ready to load';
  }
  void refreshFeatureCountDisplay();
}

export async function initServerObservationEvidenceUi(map, { getAreaId }) {
  window.__pintazAreaId = getAreaId;
  setObservationPanelDefault();
  renderServerEvidencePanel();
  evidenceState.visible = false;
  applyLayerVisibility(map);

  map.on('mousemove', (e) => observationHoverCursor(map, e));

  const layerDomId = {
    vehicle_pose: 'update-layer-vehicle-pose',
    lane_point: 'update-layer-lane-point',
    edge_point: 'update-layer-edge-point',
    gps_point: 'update-layer-gps-point',
  };
  for (const layerKey of Object.keys(evidenceState.layerVisibility)) {
    const input = el(layerDomId[layerKey]);
    input?.addEventListener('change', (e) => {
      evidenceState.layerVisibility[layerKey] = e.target.checked;
      applyLayerVisibility(map);
      if (!e.target.checked && evidenceState.selected?.layerKey === layerKey) {
        clearObservationSelection(map);
      }
    });
  }
}

export async function applyServerEvidenceVisibility(map, visible) {
  if (visible) {
    try {
      if (!evidenceState.geojson) await loadGeojson();
      ensureObservationEvidenceLayers(map);
      if (map?.getSource(UPDATE_SOURCE_ID)) {
        map.getSource(UPDATE_SOURCE_ID).setData(evidenceState.geojson);
      }
      evidenceState.visible = true;
      evidenceState.error = null;
    } catch (e) {
      evidenceState.error = e.message || 'Evidence unavailable';
      evidenceState.visible = false;
      const toggle = el('server-evidence-toggle');
      if (toggle) toggle.checked = false;
    }
  } else {
    evidenceState.visible = false;
    clearObservationSelection(map);
  }
  applyLayerVisibility(map);
  renderServerEvidencePanel();
}

export function isServerEvidenceVisible() {
  return evidenceState.visible;
}

export function onObservationEvidenceAreaChanged(map) {
  renderServerEvidencePanel();
  const areaId = window.__pintazAreaId?.() ?? null;
  if (areaId !== UPDATE_PREVIEW_AREA_ID) {
    evidenceState.visible = false;
    const toggle = el('server-evidence-toggle');
    if (toggle) toggle.checked = false;
  }
  applyLayerVisibility(map);
  clearObservationSelection(map);
}

import { attachMapResize } from './map-resize.js?v=osm-turn-lane-guidance-v2';
import {
  DETAILED_SOURCE_ID,
  detailedRoadLayerDefinitions,
  DETAILED_LAYER_IDS,
  DETAILED_FILL_LAYER_IDS,
  HIGHLIGHT_LAYER_ID,
  FIRST_DETAILED_ROAD_LAYER_ID,
} from './detailed-road-layers.js?v=osm-turn-lane-guidance-v2';
import { bindRoadDisplayOptions, applyRoadDisplayOptions } from './road-display-options.js?v=osm-turn-lane-guidance-v2';
import {
  initServerObservationEvidenceUi,
  onObservationEvidenceAreaChanged,
  ensureObservationEvidenceLayers,
  applyServerEvidenceVisibility,
} from './server-observation-evidence.js?v=osm-turn-lane-guidance-v2';
import { initLaneBaselineUi, loadLaneBaselineForArea } from './lane-baseline-layers.js?v=osm-turn-lane-guidance-v2';
import {
  initMismatchUi,
  loadMismatchForArea,
  ensureMismatchLayers,
  repositionMismatchHitLayers,
} from './mismatch-layers.js?v=osm-turn-lane-guidance-v2';
import {
  initMultiDriveUi,
  loadMultiDriveForArea,
  ensureMultiDriveLayers,
} from './multi-drive-mismatch-layers.js?v=osm-turn-lane-guidance-v2';
import {
  initMapSelection,
  loadComparisonForArea,
  ensureComparisonLayers,
  showMapSelectionCard,
  clearComparisonSelection,
} from './map-selection.js?v=osm-turn-lane-guidance-v2';
import { initCoverageUi } from './coverage-map.js?v=osm-turn-lane-guidance-v2';
import { fitMapToBounds } from './fit-local-area.js?v=osm-turn-lane-guidance-v2';
import {
  DEFAULT_AREA_ID,
  FALLBACK_AREA_ID,
  parseAreaFromLocation,
  setAreaInUrl,
  bindAreaHistory,
  areaSubtitle,
  sanitizeAreaId,
} from './area-selection.js?v=osm-turn-lane-guidance-v2';
import { initRouteExplorerUi } from './route-explorer.js?v=osm-turn-lane-guidance-v2';
import { applyDebugMapExposure } from '../lib/debug-map-hook.js';

export const APP_CACHE_VERSION = 'osm-turn-lane-guidance-v2';

export function reportStartupFailure(stage, message, resource = '') {
  const panel = document.getElementById('startup-error-panel');
  const stageEl = document.getElementById('startup-error-stage');
  const msgEl = document.getElementById('startup-error-message');
  const resEl = document.getElementById('startup-error-resource');
  if (panel) panel.classList.remove('hidden');
  if (stageEl) stageEl.textContent = stage;
  if (msgEl) msgEl.textContent = message;
  if (resEl) resEl.textContent = resource || '—';
}

const OUTLINE_SOURCE_ID = 'pintaz-area-outline';

const state = {
  map: null,
  config: null,
  localArea: null,
  areaId: DEFAULT_AREA_ID,
  areaCatalog: null,
  overlayVisible: true,
  totalFeatures: 0,
  visibleFeatureCount: 0,
  geojsonLoaded: false,
  lastClick: null,
  cursor: { lon: null, lat: null },
  mapLayersReady: false,
  areaSwitchToken: 0,
};

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return res.json();
}

function showSetupMessage(message) {
  const el = document.getElementById('setup-banner');
  el.textContent = message;
  el.classList.remove('hidden');
}

function setStartupStatus(message, code = 'startup_error') {
  const dl = document.getElementById('status-panel');
  if (dl) {
    dl.innerHTML = [
      ['Startup', message],
      ['Code', code],
    ]
      .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
      .join('');
  }
}

function clearOsmRoadHighlight() {
  const map = state.map;
  if (map?.getLayer(HIGHLIGHT_LAYER_ID)) {
    map.setFilter(HIGHLIGHT_LAYER_ID, ['==', ['get', 'osm_id'], '']);
  }
}

function clearRoadInfo() {
  const info = document.getElementById('road-info');
  if (!info) return;
  info.textContent = 'Click a road on the map.';
  info.classList.add('muted');
  state.lastClick = null;
  clearOsmRoadHighlight();
}

function clearRoadInfoAndObservation() {
  clearRoadInfo();
}

function updateSubtitle() {
  const el = document.querySelector('.subtitle');
  if (!el || !state.localArea) return;
  const name = state.localArea.displayName || state.localArea.label?.replace(/ · 2 km × 2 km$/, '');
  el.textContent = areaSubtitle(name || state.areaId);
}

function updatePanels() {
  const map = state.map;
  const la = state.localArea;
  const dl = document.getElementById('status-panel');
  if (dl) {
    dl.innerHTML = [
      ['Area', state.areaId],
      ['Map zoom', map ? map.getZoom().toFixed(2) : '—'],
      ['Road features', state.totalFeatures],
      ['Visible roads', state.visibleFeatureCount],
      ['GeoJSON loaded', state.geojsonLoaded ? 'yes' : 'no'],
    ]
      .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
      .join('');
  }
  const diag = document.getElementById('area-diagnostics');
  if (diag && la) {
    const rows = [
      ['West', la.bounds.west.toFixed(6)],
      ['South', la.bounds.south.toFixed(6)],
      ['East', la.bounds.east.toFixed(6)],
      ['North', la.bounds.north.toFixed(6)],
      ['Width (m)', la.dimensions?.widthM?.toFixed(2) ?? '—'],
      ['Height (m)', la.dimensions?.heightM?.toFixed(2) ?? '—'],
      ['Extracted features', la.extraction?.emitted ?? state.totalFeatures],
      ['Visible features', state.visibleFeatureCount],
      ['Source loaded', state.map?.getSource(DETAILED_SOURCE_ID) ? 'yes' : 'no'],
      ['GeoJSON loaded', state.geojsonLoaded ? 'yes' : 'no'],
      ['Invalid geometries', la.extraction?.rejectedInvalid ?? 0],
      ['Cursor lon', state.cursor.lon?.toFixed(5) ?? '—'],
      ['Cursor lat', state.cursor.lat?.toFixed(5) ?? '—'],
    ];
    diag.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  }
}

function fit2kmArea() {
  const map = state.map;
  const b = state.localArea?.bounds;
  if (!map || !b) return;
  fitMapToBounds(map, b, { duration: 0, maxZoom: 17 });
}

function outlineFeature(bounds) {
  return {
    type: 'Feature',
    properties: { role: '2km-outline' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [bounds.west, bounds.south],
          [bounds.east, bounds.south],
          [bounds.east, bounds.north],
          [bounds.west, bounds.north],
          [bounds.west, bounds.south],
        ],
      ],
    },
  };
}

function emptyRoadCollection() {
  return { type: 'FeatureCollection', features: [] };
}

function populateAreaSelector() {
  const select = document.getElementById('area-selector');
  if (!select || !state.areaCatalog?.areas) return;
  select.innerHTML = '';
  for (const area of state.areaCatalog.areas) {
    const opt = document.createElement('option');
    opt.value = area.id;
    opt.textContent = area.displayName;
    if (!area.boundsAvailable) {
      opt.textContent += ' (data missing)';
      opt.disabled = area.id !== FALLBACK_AREA_ID;
    }
    select.appendChild(opt);
  }
  select.value = state.areaId;
}

function resolveClientAreaId(requestedId) {
  const known = state.areaCatalog?.areas?.map((a) => a.id) ?? [];
  if (requestedId) {
    const id = sanitizeAreaId(requestedId);
    if (id && known.includes(id)) return id;
  }
  return parseAreaFromLocation(window.location.search, known.length ? known : null);
}

async function loadAreaData(areaId) {
  const meta = await fetchJson(`/api/local-area/${areaId}/meta.json`);
  const roads = await fetchJson(`/api/local-area/${areaId}/roads.geojson`);
  return { meta, roads };
}

async function applyAreaToMap(meta, roads) {
  const map = state.map;
  if (!map || !state.mapLayersReady) return;
  state.localArea = meta;
  state.totalFeatures = roads.features?.length ?? 0;
  state.geojsonLoaded = true;

  map.getSource(DETAILED_SOURCE_ID).setData(roads);
  map.getSource(OUTLINE_SOURCE_ID).setData(outlineFeature(meta.bounds));

  clearRoadInfo();
  updateSubtitle();
  fit2kmArea();
  requestAnimationFrame(() => {
    map.resize();
    fit2kmArea();
    updatePanels();
  });
  updatePanels();
}

async function switchLocalArea(requestedId, { updateUrl = true, replaceUrl = false } = {}) {
  const areaId = resolveClientAreaId(requestedId);
  const token = ++state.areaSwitchToken;
  state.areaId = areaId;

  const select = document.getElementById('area-selector');
  if (select && select.value !== areaId) select.value = areaId;

  try {
    const { meta, roads } = await loadAreaData(areaId);
    if (token !== state.areaSwitchToken) return;

    if (state.map && state.mapLayersReady) {
      await applyAreaToMap(meta, roads);
      onObservationEvidenceAreaChanged(state.map);
      loadComparisonForArea(state.map, areaId);
      loadLaneBaselineForArea(state.map, areaId);
      loadMismatchForArea(state.map, areaId);
      loadMultiDriveForArea(state.map, areaId);
    } else {
      state.localArea = meta;
      state.totalFeatures = roads.features?.length ?? 0;
      state.geojsonLoaded = true;
      state._pendingRoads = roads;
    }

    if (updateUrl) {
      setAreaInUrl(areaId, { replace: replaceUrl });
    }
  } catch (err) {
    if (areaId !== FALLBACK_AREA_ID) {
      return switchLocalArea(FALLBACK_AREA_ID, { updateUrl: true, replaceUrl: true });
    }
    throw err;
  }
}

function initMap() {
  const cfg = state.config;
  const la = state.localArea;
  if (!cfg.mapbox.configured || !cfg.mapbox.publicToken) {
    showSetupMessage('Mapbox access token is not configured in .env');
    return;
  }
  if (!la?.bounds) {
    showSetupMessage('Local 2 km road data missing. Run: node scripts/extract-2km-local-area.js <area-id>');
    return;
  }

  mapboxgl.accessToken = cfg.mapbox.publicToken;
  const map = new mapboxgl.Map({
    container: 'map',
    style: cfg.mapbox.style,
    center: [la.centre.lon, la.centre.lat],
    zoom: 15,
    minZoom: 13,
    maxZoom: 20,
    antialias: true,
  });
  state.map = map;
  if (typeof window !== 'undefined') {
    applyDebugMapExposure(map, window, window.location.hostname, window.location.search);
  }

  map.addControl(new mapboxgl.NavigationControl(), 'top-right');
  map.addControl(new mapboxgl.ScaleControl({ maxWidth: 100 }), 'bottom-left');

  const mapContainer = document.getElementById('map');
  attachMapResize(map, mapContainer);

  map.on('load', async () => {
    map.resize();
    const roads = state._pendingRoads || emptyRoadCollection();

    map.addSource(OUTLINE_SOURCE_ID, {
      type: 'geojson',
      data: outlineFeature(la.bounds),
    });
    map.addLayer({
      id: 'pintaz-area-outline-line',
      type: 'line',
      source: OUTLINE_SOURCE_ID,
      paint: {
        'line-color': '#2563eb',
        'line-width': 2,
        'line-dasharray': [3, 2],
      },
    });

    map.addSource(DETAILED_SOURCE_ID, { type: 'geojson', data: roads });
    for (const layer of detailedRoadLayerDefinitions()) {
      map.addLayer(layer);
    }
    state.mapLayersReady = true;
    delete state._pendingRoads;

    map.on('mousemove', (e) => {
      state.cursor = { lon: e.lngLat.lng, lat: e.lngLat.lat };
      updatePanels();
    });

    map.on('data', () => {
      try {
        state.visibleFeatureCount = map.queryRenderedFeatures({ layers: DETAILED_FILL_LAYER_IDS }).length;
        updatePanels();
      } catch {
        /* ignore */
      }
    });

    initServerObservationEvidenceUi(map, { getAreaId: () => state.areaId });
    await initRouteExplorerUi(map, { getAreaId: () => state.areaId });
    ensureObservationEvidenceLayers(map);
    ensureComparisonLayers(map);
    ensureMismatchLayers(map);
    ensureMultiDriveLayers(map);
    const laneBaselineUi = initLaneBaselineUi(map, {
      getAreaId: () => state.areaId,
      getEvidenceVisible: () => document.getElementById('server-evidence-toggle')?.checked ?? false,
      beforeLayerId: FIRST_DETAILED_ROAD_LAYER_ID,
    });
    let mismatchApi = null;
    mismatchApi = initMismatchUi(map, {
      getAreaId: () => state.areaId,
      onSelectionCard: (mode, html, title) => showMapSelectionCard(mode, html, title),
    });
    const multiDriveApi = initMultiDriveUi(map, {
      getAreaId: () => state.areaId,
      onSelectionCard: (mode, html, title) => showMapSelectionCard(mode, html, title),
    });
    const clearMapSelections = () => {
      clearOsmRoadHighlight();
      clearComparisonSelection(map);
      multiDriveApi?.clearHighlight();
    };
    const handleMapClick = initMapSelection(map, {
      getAreaId: () => state.areaId,
      clearOsmRoadHighlight,
      onEvidenceVisibilityChange: async (visible) => {
        await applyServerEvidenceVisibility(state.map, visible);
        laneBaselineUi.syncObservationCoverage();
        repositionMismatchHitLayers(state.map);
      },
      tryMultiDriveCandidateClick: (e) =>
        multiDriveApi?.handleCandidateClick(e, { clearOthers: clearMapSelections }) ?? false,
      tryMultiDriveConsistentClick: (e) =>
        multiDriveApi?.handleConsistentClick(e, { clearOthers: clearMapSelections }) ?? false,
      tryMultiDriveDiagnosticClick: (e) =>
        multiDriveApi?.handleDiagnosticClick(e, {
          clearOthers: clearMapSelections,
          evidenceVisible: document.getElementById('server-evidence-toggle')?.checked ?? false,
        }) ?? false,
      tryMismatchCandidateClick: (e) =>
        mismatchApi?.handleMismatchCandidateClick(map, e, {
          clearOthers: clearMapSelections,
        }) ?? false,
      tryMismatchNonCandidateClick: (e) =>
        mismatchApi?.handleMismatchNonCandidateClick(map, e, {
          clearOthers: clearMapSelections,
        }) ?? false,
    });
    loadComparisonForArea(map, state.areaId);
    loadLaneBaselineForArea(map, state.areaId);
    loadMismatchForArea(map, state.areaId);
    loadMultiDriveForArea(map, state.areaId);

    map.on('click', (e) => {
      handleMapClick(e);
    });

    fit2kmArea();
    updatePanels();
    const refreshDisplay = bindRoadDisplayOptions(map, () => state.overlayVisible);
    refreshDisplay();

    requestAnimationFrame(() => {
      map.resize();
      fit2kmArea();
      refreshDisplay();
      updatePanels();
    });
  });

  map.on('zoom', updatePanels);
  map.on('moveend', updatePanels);
}

function bindUi() {
  document.getElementById('overlay-toggle').addEventListener('change', (e) => {
    state.overlayVisible = e.target.checked;
    applyRoadDisplayOptions(state.map, {
      overlayVisible: state.overlayVisible,
      showPaths: document.getElementById('show-paths')?.checked ?? true,
      showOneway: document.getElementById('show-oneway')?.checked ?? false,
      showLabels: document.getElementById('show-labels')?.checked ?? true,
      emphasizeBridgeTunnel: document.getElementById('emphasize-bridge-tunnel')?.checked ?? false,
    });
  });
  document.getElementById('fit-2km').addEventListener('click', fit2kmArea);

  const select = document.getElementById('area-selector');
  if (select) {
    select.addEventListener('change', (e) => {
      switchLocalArea(e.target.value, { updateUrl: true });
    });
  }

  bindAreaHistory((areaId) => {
    switchLocalArea(areaId, { updateUrl: false });
  });
}

async function main() {
  state.config = await fetchJson('/api/config');
  state.areaCatalog = await fetchJson('/api/local-areas');

  const knownIds = state.areaCatalog.areas.map((a) => a.id);
  const initialArea = parseAreaFromLocation(window.location.search, knownIds);
  state.areaId = initialArea;

  populateAreaSelector();

  const { meta, roads } = await loadAreaData(initialArea);
  state.localArea = meta;
  state.totalFeatures = roads.features?.length ?? 0;
  state.geojsonLoaded = true;
  state._pendingRoads = roads;
  updateSubtitle();

  bindUi();
  initMap();
  document.getElementById('attr-mapbox').textContent = '© Mapbox © OpenStreetMap';

  setAreaInUrl(initialArea, { replace: true });

  const map = state.map;
  if (map) {
    initCoverageUi(map, fit2kmArea);
  } else {
    setTimeout(() => {
      if (state.map) initCoverageUi(state.map, fit2kmArea);
    }, 2000);
  }
}

main().catch((err) => {
  const safe = err?.message ? String(err.message).slice(0, 200) : 'Unknown error';
  const resource = err?.resource || err?.url || '';
  showSetupMessage(`Failed to load: ${safe}`);
  reportStartupFailure('app_startup', safe, resource);
  setStartupStatus(
    'Map failed to start — see startup error panel or Debug details.',
    'startup_failed'
  );
});

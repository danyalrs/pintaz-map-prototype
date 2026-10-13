import {
  turnGuidanceLayerDefinition,
  TURN_GUIDANCE_MIN_ZOOM,
  turnGuidanceLayerVisibility,
} from '../lib/turn-guidance-map-layer.js';

export const LANE_SURFACE_SOURCE = 'pintaz-lane-surfaces';
export const LANE_DIVIDER_SOURCE = 'pintaz-lane-dividers';
export const LANE_DIRECTION_SOURCE = 'pintaz-lane-direction';
export const LANE_UNKNOWN_SOURCE = 'pintaz-lane-unknown-outline';
export const OBS_COVERAGE_SOURCE = 'pintaz-observation-coverage';
export const TURN_GUIDANCE_SOURCE = 'pintaz-turn-lane-guidance';

export const LANE_LAYER = {
  surfaces: 'pintaz-lane-surfaces-fill',
  dividers: 'pintaz-lane-dividers-line',
  direction: 'pintaz-lane-direction-arrows',
  unknown: 'pintaz-lane-unknown-fill',
  coverage: 'pintaz-observation-coverage-line',
  turnGuidance: 'pintaz-turn-lane-guidance-symbols',
};

const LANE_BASELINE_AREA = 'bukit-bintang-imbi';
const DIVIDER_MIN_ZOOM = 15;

export { TURN_GUIDANCE_MIN_ZOOM };

const uiState = {
  loaded: false,
  areaId: null,
  summary: null,
  showSurfaces: true,
  showDividers: true,
  showDirection: true,
  showUnknown: true,
  showCoverage: false,
  showTurnGuidance: false,
};

function el(id) {
  return document.getElementById(id);
}

function applyVisibility(map) {
  if (!map) return;
  const vis = (on) => (on ? 'visible' : 'none');
  if (map.getLayer(LANE_LAYER.surfaces)) map.setLayoutProperty(LANE_LAYER.surfaces, 'visibility', vis(uiState.showSurfaces));
  if (map.getLayer(LANE_LAYER.dividers)) {
    map.setLayoutProperty(LANE_LAYER.dividers, 'visibility', vis(uiState.showDividers));
    map.setLayerZoomRange(LANE_LAYER.dividers, DIVIDER_MIN_ZOOM, 24);
  }
  if (map.getLayer(LANE_LAYER.direction)) map.setLayoutProperty(LANE_LAYER.direction, 'visibility', vis(uiState.showDirection));
  if (map.getLayer(LANE_LAYER.unknown)) map.setLayoutProperty(LANE_LAYER.unknown, 'visibility', vis(uiState.showUnknown));
  if (map.getLayer(LANE_LAYER.coverage)) map.setLayoutProperty(LANE_LAYER.coverage, 'visibility', vis(uiState.showCoverage));
  if (map.getLayer(LANE_LAYER.turnGuidance)) {
    map.setLayoutProperty(
      LANE_LAYER.turnGuidance,
      'visibility',
      turnGuidanceLayerVisibility(uiState.showTurnGuidance)
    );
    map.setLayerZoomRange(LANE_LAYER.turnGuidance, TURN_GUIDANCE_MIN_ZOOM, 24);
  }
}

/** Turn symbols must render above detailed road fills (not under beforeLayerId stack). */
export function ensureTurnGuidanceLayerOnTop(map) {
  if (!map?.getSource(TURN_GUIDANCE_SOURCE)) return;
  if (map.getLayer(LANE_LAYER.turnGuidance)) return;
  map.addLayer(turnGuidanceLayerDefinition(LANE_LAYER.turnGuidance, TURN_GUIDANCE_SOURCE));
  applyVisibility(map);
}

export function ensureLaneBaselineLayers(map, beforeLayerId) {
  if (!map || map.getSource(LANE_SURFACE_SOURCE)) return;
  map.addSource(LANE_SURFACE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource(LANE_DIVIDER_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource(LANE_DIRECTION_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource(LANE_UNKNOWN_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource(OBS_COVERAGE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource(TURN_GUIDANCE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

  map.addLayer(
    {
      id: LANE_LAYER.surfaces,
      type: 'fill',
      source: LANE_SURFACE_SOURCE,
      filter: ['==', ['get', 'surface_role'], 'osm_derived'],
      minzoom: 14,
      paint: { 'fill-color': '#cbd5e1', 'fill-opacity': 0.55 },
    },
    beforeLayerId
  );
  map.addLayer(
    {
      id: LANE_LAYER.unknown,
      type: 'fill',
      source: LANE_UNKNOWN_SOURCE,
      minzoom: 14,
      paint: {
        'fill-color': '#94a3b8',
        'fill-opacity': 0.12,
        'fill-outline-color': '#64748b',
      },
    },
    beforeLayerId
  );
  map.addLayer(
    {
      id: LANE_LAYER.dividers,
      type: 'line',
      source: LANE_DIVIDER_SOURCE,
      minzoom: DIVIDER_MIN_ZOOM,
      paint: {
        'line-color': '#ffffff',
        'line-width': ['case', ['==', ['get', 'divider_style'], 'centre_neutral'], 1.4, 1.2],
        'line-opacity': 0.85,
        'line-dasharray': [
          'case',
          ['==', ['get', 'divider_style'], 'centre_neutral'],
          ['literal', [1, 1.5]],
          ['literal', [2, 2]],
        ],
      },
    },
    beforeLayerId
  );
  map.addLayer(
    {
      id: LANE_LAYER.direction,
      type: 'symbol',
      source: LANE_DIRECTION_SOURCE,
      minzoom: 14,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 45,
        'text-field': '▶',
        'text-size': 13,
        'text-keep-upright': false,
      },
      paint: { 'text-color': '#1e40af', 'text-halo-color': '#fff', 'text-halo-width': 1 },
    },
    beforeLayerId
  );
  map.addLayer(
    {
      id: LANE_LAYER.coverage,
      type: 'line',
      source: OBS_COVERAGE_SOURCE,
      paint: {
        'line-color': '#6366f1',
        'line-width': 2,
        'line-opacity': 0.45,
        'line-dasharray': [4, 3],
      },
    },
    beforeLayerId
  );
  applyVisibility(map);
}

function updatePanel() {
  const noArea = el('lane-baseline-no-area');
  const empty = el('lane-baseline-empty');
  const body = el('lane-baseline-body');
  if (uiState.areaId !== LANE_BASELINE_AREA) {
    noArea?.classList.remove('hidden');
    empty?.classList.add('hidden');
    body?.classList.add('hidden');
    return;
  }
  noArea?.classList.add('hidden');
  if (!uiState.summary) {
    empty?.classList.remove('hidden');
    body?.classList.add('hidden');
    return;
  }
  empty?.classList.add('hidden');
  body?.classList.remove('hidden');
  const c = uiState.summary.counts || {};
  const set = (id, v) => {
    const n = el(id);
    if (n) n.textContent = String(v ?? 0);
  };
  set('lane-count-osm-roads', c.osm_roads);
  set('lane-count-usable', c.with_usable_lane_count);
  set('lane-count-directional', c.with_directional_lane_data);
  set('lane-count-estimated-width', c.with_estimated_display_width);
  set('lane-count-unknown', c.unknown_lane_count);
}

export async function loadLaneBaselineForArea(map, areaId) {
  uiState.areaId = areaId;
  updatePanel();
  if (!map) return;
  const empty = { type: 'FeatureCollection', features: [] };
  if (areaId !== LANE_BASELINE_AREA) {
    map.getSource(LANE_SURFACE_SOURCE)?.setData(empty);
    map.getSource(LANE_DIVIDER_SOURCE)?.setData(empty);
    map.getSource(LANE_DIRECTION_SOURCE)?.setData(empty);
    map.getSource(LANE_UNKNOWN_SOURCE)?.setData(empty);
    map.getSource(OBS_COVERAGE_SOURCE)?.setData(empty);
    map.getSource(TURN_GUIDANCE_SOURCE)?.setData(empty);
    uiState.summary = null;
    uiState.loaded = false;
    return;
  }
  try {
    const sum = await fetch(`/api/lane-baseline/v1/${areaId}/summary`).then((r) => (r.ok ? r.json() : null));
    uiState.summary = sum;
    if (!sum) {
      updatePanel();
      return;
    }
    const [surfaces, dividers, directions, turnGuidance] = await Promise.all([
      fetch(`/api/lane-baseline/v1/${areaId}/surfaces.geojson`).then((r) => r.json()),
      fetch(`/api/lane-baseline/v1/${areaId}/dividers.geojson`).then((r) => r.json()),
      fetch(`/api/lane-baseline/v1/${areaId}/direction-markers.geojson`).then((r) => r.json()),
      fetch(`/api/lane-baseline/v1/${areaId}/turn-lane-guidance.geojson`).then((r) => r.json()),
    ]);
    const unknown = {
      type: 'FeatureCollection',
      features: (surfaces.features || []).filter((f) => f.properties?.surface_role === 'unknown_lane_outline'),
    };
    const knownSurfaces = {
      type: 'FeatureCollection',
      features: (surfaces.features || []).filter((f) => f.properties?.surface_role === 'osm_derived'),
    };
    map.getSource(LANE_SURFACE_SOURCE)?.setData(knownSurfaces);
    map.getSource(LANE_UNKNOWN_SOURCE)?.setData(unknown);
    map.getSource(LANE_DIVIDER_SOURCE)?.setData(dividers);
    map.getSource(LANE_DIRECTION_SOURCE)?.setData(directions);
    map.getSource(TURN_GUIDANCE_SOURCE)?.setData({
      type: 'FeatureCollection',
      features: turnGuidance.features || [],
    });
    uiState.loaded = true;
    updatePanel();
    applyVisibility(map);
  } catch {
    uiState.summary = null;
    updatePanel();
  }
}

export async function loadObservationCoverageOutline(map, visible) {
  uiState.showCoverage = visible;
  if (!map?.getSource(OBS_COVERAGE_SOURCE)) return;
  if (!visible) {
    map.getSource(OBS_COVERAGE_SOURCE).setData({ type: 'FeatureCollection', features: [] });
    applyVisibility(map);
    return;
  }
  try {
    const geo = await fetch('/api/lane-baseline/v1/observation-coverage.geojson').then((r) => r.json());
    map.getSource(OBS_COVERAGE_SOURCE).setData(geo);
  } catch {
    map.getSource(OBS_COVERAGE_SOURCE).setData({ type: 'FeatureCollection', features: [] });
  }
  applyVisibility(map);
}

export async function fetchDerivedRoadInfo(areaId, osmId) {
  if (areaId !== LANE_BASELINE_AREA) return null;
  const res = await fetch(`/api/lane-baseline/v1/${areaId}/road/${encodeURIComponent(osmId)}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.derived;
}

export function initLaneBaselineUi(map, { getAreaId, getEvidenceVisible, beforeLayerId }) {
  ensureLaneBaselineLayers(map, beforeLayerId);
  ensureTurnGuidanceLayerOnTop(map);
  loadLaneBaselineForArea(map, getAreaId());

  el('lane-baseline-surfaces-toggle')?.addEventListener('change', (e) => {
    uiState.showSurfaces = e.target.checked;
    applyVisibility(map);
  });
  el('lane-baseline-dividers-toggle')?.addEventListener('change', (e) => {
    uiState.showDividers = e.target.checked;
    applyVisibility(map);
  });
  el('lane-baseline-direction-toggle')?.addEventListener('change', (e) => {
    uiState.showDirection = e.target.checked;
    applyVisibility(map);
  });
  el('lane-baseline-unknown-toggle')?.addEventListener('change', (e) => {
    uiState.showUnknown = e.target.checked;
    applyVisibility(map);
  });
  el('lane-baseline-turn-guidance-toggle')?.addEventListener('change', (e) => {
    uiState.showTurnGuidance = e.target.checked;
    applyVisibility(map);
  });

  el('lane-baseline-fit')?.addEventListener('click', async () => {
    const areaId = getAreaId();
    if (areaId !== LANE_BASELINE_AREA) return;
    const geo = await fetch(`/api/lane-baseline/v1/${areaId}/surfaces.geojson`).then((r) => r.json());
    const feats = (geo.features || []).filter((f) => f.properties?.lane_count_total);
    if (!feats.length) return;
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const f of feats) {
      const ring = f.geometry?.coordinates?.[0] || [];
      for (const [lon, lat] of ring) {
        west = Math.min(west, lon);
        south = Math.min(south, lat);
        east = Math.max(east, lon);
        north = Math.max(north, lat);
      }
    }
    map.resize();
    map.fitBounds([[west, south], [east, north]], { padding: { top: 60, bottom: 48, left: 300, right: 80 }, maxZoom: 16 });
  });

  const syncCoverage = () => loadObservationCoverageOutline(map, getEvidenceVisible());
  syncCoverage();
  return { syncObservationCoverage: syncCoverage };
}

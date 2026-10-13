/**
 * Coverage inventory display mode (does not replace pilot road overlay).
 */
const coverageState = {
  enabled: false,
  zoom: 12,
  minRoadCount: 1,
  showMissingInternal: true,
  components: [],
  summary: null,
  selectedComponentId: null,
  hoverInfo: null,
};

let coverageMapRef = null;
let coverageHandlersBound = false;

function coverageSourceId(z) {
  return `coverage-tiles-z${z}`;
}

function missingSourceId(z) {
  return `coverage-missing-z${z}`;
}

function componentSourceId() {
  return 'coverage-component-bounds';
}

export function getCoverageState() {
  return coverageState;
}

function removeCoverageLayers(map) {
  const layers = [
    'coverage-tile-fill',
    'coverage-missing-fill',
    'coverage-component-outline',
    'coverage-tile-line',
  ];
  for (const id of layers) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const z of [10, 12, 14]) {
    const sid = coverageSourceId(z);
    const mid = missingSourceId(z);
    if (map.getSource(sid)) map.removeSource(sid);
    if (map.getSource(mid)) map.removeSource(mid);
  }
  if (map.getSource(componentSourceId())) map.removeSource(componentSourceId());
}

async function loadGeoJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`coverage geojson ${res.status}`);
  return res.json();
}

function missingFeaturesForZoom(z) {
  if (!coverageState.showMissingInternal) return { type: 'FeatureCollection', features: [] };
  const features = [];
  for (const c of coverageState.components.filter((x) => x.zoom === z)) {
    for (const t of c.missingInternalSample || []) {
      const n = 2 ** z;
      const west = (t.x / n) * 360 - 180;
      const east = ((t.x + 1) / n) * 360 - 180;
      const north = (Math.atan(Math.sinh(Math.PI * (1 - (2 * t.y) / n))) * 180) / Math.PI;
      const south = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (t.y + 1)) / n))) * 180) / Math.PI;
      features.push({
        type: 'Feature',
        properties: { z: t.z, x: t.x, y: t.y, componentId: c.componentId, status: 'missing_internal' },
        geometry: {
          type: 'Polygon',
          coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
        },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

function componentBoundsGeoJson(z) {
  const features = coverageState.components
    .filter((c) => c.zoom === z)
    .map((c) => {
      const { west, south, east, north } = c.bounds;
      return {
        type: 'Feature',
        properties: {
          componentId: c.componentId,
          tileCount: c.tileCount,
          roadFeatureCount: c.roadFeatureCount,
          completenessPct: c.completenessPct,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
        },
      };
    });
  return { type: 'FeatureCollection', features };
}

function applyCoverageFilters(map) {
  const z = coverageState.zoom;
  const sid = coverageSourceId(z);
  if (!map.getLayer('coverage-tile-fill')) return;
  map.setFilter('coverage-tile-fill', [
    'all',
    ['>=', ['get', 'roadCount'], coverageState.minRoadCount],
    ['any', ['==', ['get', 'status'], 'roads'], ['==', ['get', 'status'], 'sparse']],
  ]);
  map.setLayoutProperty('coverage-missing-fill', 'visibility', coverageState.showMissingInternal ? 'visible' : 'none');
}

async function ensureCoverageSources(map) {
  const z = coverageState.zoom;
  const sid = coverageSourceId(z);
  if (!map.getSource(sid)) {
    const geo = await loadGeoJson(`/api/coverage/geojson/${z}`);
    map.addSource(sid, { type: 'geojson', data: geo });
  }
  const mid = missingSourceId(z);
  if (!map.getSource(mid)) {
    map.addSource(mid, { type: 'geojson', data: missingFeaturesForZoom(z) });
  }
  const cid = componentSourceId();
  if (!map.getSource(cid)) {
    map.addSource(cid, { type: 'geojson', data: componentBoundsGeoJson(z) });
  } else {
    map.getSource(cid).setData(componentBoundsGeoJson(z));
  }

  if (!map.getLayer('coverage-tile-fill')) {
    map.addLayer({
      id: 'coverage-tile-fill',
      type: 'fill',
      source: sid,
      paint: {
        'fill-color': [
          'match',
          ['get', 'status'],
          'roads',
          '#22c55e',
          'sparse',
          '#eab308',
          'no_roads',
          '#94a3b8',
          'decode_fail',
          '#f97316',
          '#e2e8f0',
        ],
        'fill-opacity': 0.45,
      },
    });
    map.addLayer({
      id: 'coverage-tile-line',
      type: 'line',
      source: sid,
      paint: { 'line-color': '#0f172a', 'line-width': 0.3, 'line-opacity': 0.35 },
    });
    map.addLayer({
      id: 'coverage-missing-fill',
      type: 'fill',
      source: mid,
      paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.35 },
    });
    map.addLayer({
      id: 'coverage-component-outline',
      type: 'line',
      source: cid,
      paint: { 'line-color': '#1d4ed8', 'line-width': 2, 'line-dasharray': [2, 1] },
    });
  } else {
    const prev = map.getLayer('coverage-tile-fill').source;
    if (prev !== sid) {
      removeCoverageLayers(map);
      await ensureCoverageSources(map);
      return;
    }
  }
  applyCoverageFilters(map);
}

export async function setCoverageEnabled(map, enabled) {
  coverageState.enabled = enabled;
  if (!enabled) {
    removeCoverageLayers(map);
    return;
  }
  await ensureCoverageSources(map);
  applyCoverageFilters(map);
}

export async function refreshCoverageLayer(map) {
  if (!coverageState.enabled) return;
  removeCoverageLayers(map);
  await ensureCoverageSources(map);
  applyCoverageFilters(map);
}

export async function initCoverageUi(map, pilotFitFn) {
  coverageMapRef = map;
  if (!coverageState.summary) {
    try {
      coverageState.summary = await fetch('/api/coverage/summary').then((r) => r.json());
      coverageState.components = await fetch('/api/coverage/components').then((r) => r.json());
    } catch {
      coverageState.summary = null;
    }
  }

  if (coverageHandlersBound) return;
  coverageHandlersBound = true;

  const modeToggle = document.getElementById('coverage-mode-toggle');
  const zoomSel = document.getElementById('coverage-zoom');
  const minRoad = document.getElementById('coverage-min-roads');
  const missingToggle = document.getElementById('coverage-show-missing');
  const fitMy = document.getElementById('coverage-fit-malaysia');
  const fitComp = document.getElementById('coverage-fit-component');
  const returnPilot = document.getElementById('coverage-return-pilot');
  const hoverEl = document.getElementById('coverage-hover-info');

  modeToggle?.addEventListener('change', async (e) => {
    await setCoverageEnabled(map, e.target.checked);
  });
  zoomSel?.addEventListener('change', async (e) => {
    coverageState.zoom = Number(e.target.value);
    await refreshCoverageLayer(map);
  });
  minRoad?.addEventListener('input', (e) => {
    coverageState.minRoadCount = Number(e.target.value) || 0;
    applyCoverageFilters(map);
  });
  missingToggle?.addEventListener('change', async (e) => {
    coverageState.showMissingInternal = e.target.checked;
    await refreshCoverageLayer(map);
  });
  fitMy?.addEventListener('click', () => {
    const my = coverageState.components.filter((c) => c.country === 'MY' && c.zoom === coverageState.zoom);
    if (!my.length) return;
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const c of my) {
      west = Math.min(west, c.bounds.west);
      south = Math.min(south, c.bounds.south);
      east = Math.max(east, c.bounds.east);
      north = Math.max(north, c.bounds.north);
    }
    map.fitBounds([[west, south], [east, north]], { padding: 40, duration: 800, maxZoom: 12 });
  });
  fitComp?.addEventListener('click', () => {
    const id = coverageState.selectedComponentId;
    const c = coverageState.components.find((x) => x.componentId === id);
    if (!c) return;
    map.fitBounds([[c.bounds.west, c.bounds.south], [c.bounds.east, c.bounds.north]], {
      padding: 32,
      duration: 800,
      maxZoom: 15,
    });
  });
  returnPilot?.addEventListener('click', () => {
    modeToggle.checked = false;
    setCoverageEnabled(map, false);
    pilotFitFn();
  });

  map.on('mousemove', (e) => {
    if (!coverageState.enabled || !hoverEl) return;
    const feats = map.queryRenderedFeatures(e.point, { layers: ['coverage-tile-fill'] });
    if (!feats.length) {
      hoverEl.textContent = '';
      return;
    }
    const p = feats[0].properties;
    coverageState.selectedComponentId = p.componentId || coverageState.selectedComponentId;
    hoverEl.textContent = `z${p.z}/${p.x}/${p.y} · roads=${p.roadCount} · ${p.status} · ${p.componentId || '—'}`;
  });

  map.on('click', (e) => {
    if (!coverageState.enabled) return;
    const feats = map.queryRenderedFeatures(e.point, { layers: ['coverage-component-outline', 'coverage-tile-fill'] });
    if (!feats.length) return;
    const p = feats[0].properties;
    if (p.componentId) coverageState.selectedComponentId = p.componentId;
    const c = coverageState.components.find((x) => x.componentId === p.componentId);
    if (c && hoverEl) {
      hoverEl.textContent = `${c.componentId}: ${c.tileCount} tiles, ${c.roadFeatureCount} roads, ${c.completenessPct.toFixed(1)}% complete`;
    }
  });
}

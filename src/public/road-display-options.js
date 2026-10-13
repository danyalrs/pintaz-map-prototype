import {
  DETAILED_LAYER_IDS,
  LABEL_LAYER_ID,
  ONEWAY_LAYER_ID,
  HIGHLIGHT_LAYER_ID,
  PATH_LAYER_IDS,
} from './detailed-road-layers.js?v=startup-fix-2';

const BRIDGE_TUNNEL_RE = /^pintaz-road-(bridge|tunnel)-/;

export function pathLayerIds() {
  return [...PATH_LAYER_IDS];
}

export function bridgeTunnelLayerIds() {
  return DETAILED_LAYER_IDS.filter((id) => BRIDGE_TUNNEL_RE.test(id));
}

export function allOverlayLayerIds() {
  return [...DETAILED_LAYER_IDS, LABEL_LAYER_ID, ONEWAY_LAYER_ID, HIGHLIGHT_LAYER_ID];
}

export function applyRoadDisplayOptions(map, options) {
  if (!map) return;
  const {
    overlayVisible = true,
    showPaths = true,
    showOneway = false,
    showLabels = true,
    emphasizeBridgeTunnel = false,
  } = options;

  const vis = (on) => (overlayVisible && on ? 'visible' : 'none');

  for (const id of DETAILED_LAYER_IDS) {
    if (!map.getLayer(id)) continue;
    let show = overlayVisible;
    if (pathLayerIds().includes(id)) show = overlayVisible && showPaths;
    map.setLayoutProperty(id, 'visibility', show ? 'visible' : 'none');

    if (BRIDGE_TUNNEL_RE.test(id)) {
      const base = id.endsWith('-casing') ? 0.85 : 0.92;
      const tunnel = id.includes('-tunnel-');
      const opacity = emphasizeBridgeTunnel
        ? 1
        : tunnel
          ? id.endsWith('-casing')
            ? 0.55
            : 0.6
          : id.includes('-bridge-')
            ? id.endsWith('-casing')
              ? 0.98
              : 0.95
            : base;
      map.setPaintProperty(id, 'line-opacity', overlayVisible ? opacity : 0);
    }
  }

  if (map.getLayer(LABEL_LAYER_ID)) {
    map.setLayoutProperty(LABEL_LAYER_ID, 'visibility', vis(showLabels));
  }
  if (map.getLayer(ONEWAY_LAYER_ID)) {
    map.setLayoutProperty(ONEWAY_LAYER_ID, 'visibility', vis(showOneway));
  }
  if (map.getLayer(HIGHLIGHT_LAYER_ID)) {
    map.setLayoutProperty(HIGHLIGHT_LAYER_ID, 'visibility', overlayVisible ? 'visible' : 'none');
  }
}

export function bindRoadDisplayOptions(map, getOverlayVisible) {
  const ids = ['show-paths', 'show-oneway', 'show-labels', 'emphasize-bridge-tunnel'];
  const read = () => ({
    overlayVisible: getOverlayVisible(),
    showPaths: document.getElementById('show-paths')?.checked ?? true,
    showOneway: document.getElementById('show-oneway')?.checked ?? false,
    showLabels: document.getElementById('show-labels')?.checked ?? true,
    emphasizeBridgeTunnel: document.getElementById('emphasize-bridge-tunnel')?.checked ?? false,
  });

  const refresh = () => applyRoadDisplayOptions(map, read());

  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', refresh);
  }

  return refresh;
}

/** Mapbox GL layout/paint for OSM turn-guidance symbols (shared by UI + tests). */
export const TURN_GUIDANCE_MIN_ZOOM = 16;

export function turnGuidanceLayerVisibility(showTurnGuidance) {
  return showTurnGuidance ? 'visible' : 'none';
}

export function turnGuidanceLayerDefinition(layerId, sourceId) {
  return {
    id: layerId,
    type: 'symbol',
    source: sourceId,
    minzoom: TURN_GUIDANCE_MIN_ZOOM,
    layout: {
      'symbol-placement': 'point',
      'text-field': ['get', 'glyph'],
      'text-size': 18,
      'text-rotate': ['get', 'bearing'],
      'text-rotation-alignment': 'map',
      'text-keep-upright': false,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'text-padding': 1,
    },
    paint: {
      'text-color': '#0f766e',
      'text-halo-color': '#ffffff',
      'text-halo-width': 2,
      'text-opacity': 1,
    },
  };
}

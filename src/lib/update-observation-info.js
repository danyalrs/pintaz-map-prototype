export const UPDATE_PREVIEW_AREA_ID = 'bukit-bintang-imbi';

export const UPDATE_PREVIEW_LAYER_STYLES = {
  vehicle_pose: { color: '#2563eb', label: 'Vehicle pose' },
  lane_point: { color: '#16a34a', label: 'Lane observation' },
  edge_point: { color: '#ea580c', label: 'Road-edge observation' },
  gps_point: { color: '#c026d3', label: 'GPS fix' },
};

export const UPDATE_SOURCE_ID = 'pintaz-update-preview';
export const UPDATE_LAYER_IDS = {
  vehicle_pose: 'pintaz-update-vehicle_pose',
  lane_point: 'pintaz-update-lane_point',
  edge_point: 'pintaz-update-edge_point',
  gps_point: 'pintaz-update-gps_point',
};

export const ALL_UPDATE_LAYER_IDS = Object.values(UPDATE_LAYER_IDS);

export function updatePreviewLayerDefinitions() {
  const base = {
    type: 'circle',
    source: UPDATE_SOURCE_ID,
    paint: {
      'circle-opacity': 0.72,
      'circle-stroke-width': 1,
      'circle-stroke-color': '#ffffff',
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        13,
        2,
        16,
        4,
        19,
        6,
      ],
    },
  };
  const layers = [];
  for (const [layerKey, style] of Object.entries(UPDATE_PREVIEW_LAYER_STYLES)) {
    layers.push({
      ...base,
      id: UPDATE_LAYER_IDS[layerKey],
      filter: ['==', ['get', 'layer'], layerKey],
      paint: {
        ...base.paint,
        'circle-color': style.color,
      },
      layout: { visibility: 'none' },
    });
  }
  return layers;
}

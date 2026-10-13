import {
  ALL_UPDATE_LAYER_IDS,
  UPDATE_LAYER_IDS,
  UPDATE_PREVIEW_LAYER_STYLES,
  UPDATE_PREVIEW_AREA_ID,
} from './update-observation-info.js';

export const OBSERVATION_HIT_RADIUS_PX = 6;

export const LAYER_KEY_BY_MAP_ID = Object.fromEntries(
  Object.entries(UPDATE_LAYER_IDS).map(([key, id]) => [id, key])
);

/**
 * @param {{ x: number, y: number }} point
 * @returns {[[number, number], [number, number]]}
 */
export function observationClickQueryBox(point, radiusPx = OBSERVATION_HIT_RADIUS_PX) {
  const r = radiusPx;
  return [[point.x - r, point.y - r], [point.x + r, point.y + r]];
}

/**
 * Layers that are visible on the map and enabled in the UI.
 */
export function getSelectableObservationLayerIds(map, state) {
  if (!map || !state?.visible) return [];
  if (state.areaId !== UPDATE_PREVIEW_AREA_ID) return [];
  const ids = [];
  for (const layerId of ALL_UPDATE_LAYER_IDS) {
    const key = LAYER_KEY_BY_MAP_ID[layerId];
    if (!state.layerVisibility?.[key]) continue;
    if (!map.getLayer(layerId)) continue;
    if (map.getLayoutProperty(layerId, 'visibility') !== 'visible') continue;
    ids.push(layerId);
  }
  return ids;
}

/**
 * @param {import('mapbox-gl').Map} map
 * @param {{ x: number, y: number }} point
 * @param {string[]} layerIds
 */
export function queryObservationFeaturesAtClick(map, point, layerIds, radiusPx = OBSERVATION_HIT_RADIUS_PX) {
  if (!layerIds.length) return [];
  const box = observationClickQueryBox(point, radiusPx);
  return map.queryRenderedFeatures(box, { layers: layerIds });
}

export function pickTopObservationFeature(features) {
  if (!features?.length) return null;
  return features[0];
}

function notProvided(value) {
  if (value === null) return 'null (was NaN in raw API)';
  if (value === undefined || value === '') return 'Not provided';
  return String(value);
}

export function redactDongleInSourceFile(name) {
  if (!name || typeof name !== 'string') return 'Not provided';
  const donglePart = name.split('---')[0] || '';
  if (donglePart.length >= 8) {
    return `${donglePart.slice(0, 4)}… (source file redacted)`;
  }
  return 'Not provided';
}

export function observationTypeLabel(layerKey) {
  return UPDATE_PREVIEW_LAYER_STYLES[layerKey]?.label ?? layerKey ?? 'Not provided';
}

export function colorForObservationLayer(layerKey) {
  return UPDATE_PREVIEW_LAYER_STYLES[layerKey]?.color ?? '#2563eb';
}

/**
 * Safe fields for the Observation info panel (no raw JSON dump).
 */
export function buildObservationPanelFields(props, coords) {
  const layerKey = props?.layer ?? '';
  const rows = [
    ['Observation type', observationTypeLabel(layerKey)],
    ['Longitude', coords?.[0] != null ? Number(coords[0]).toFixed(6) : 'Not provided'],
    ['Latitude', coords?.[1] != null ? Number(coords[1]).toFixed(6) : 'Not provided'],
    ['Segment frame index', notProvided(props?.segment_frame_index)],
    ['Chunk / pass', `${notProvided(props?.chunk_id)} / ${notProvided(props?.pass_id)}`],
    ['Frame index', notProvided(props?.frame_index)],
    ['Frame id', notProvided(props?.frame_id)],
    ['Time (t)', notProvided(props?.t)],
    ['Lane index', notProvided(props?.lane_index)],
    ['Edge index', notProvided(props?.edge_index)],
    ['Lane probability', notProvided(props?.lane_probability)],
    ['Edge probability', notProvided(props?.edge_probability)],
    ['GPS source', notProvided(props?.source ?? props?.heading_source ?? props?.channel)],
    ['Point selection', notProvided(props?.point_selection)],
    ['Interpolation / heading source', notProvided(props?.heading_source)],
    ['Source file', redactDongleInSourceFile(props?.source_file)],
  ];
  return {
    layerKey,
    rows,
    disclaimer: 'Preview observation — not part of the accepted OSM baseline',
  };
}

export function renderObservationPanelHtml(fields) {
  const body = fields.rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  return `<p class="observation-disclaimer">${fields.disclaimer}</p><dl class="status-dl compact-dl">${body}</dl>`;
}

export const SELECTION_SOURCE_ID = 'pintaz-update-selection';
export const SELECTION_LAYER_ID = 'pintaz-update-selection-halo';

export function emptySelectionCollection() {
  return { type: 'FeatureCollection', features: [] };
}

export function selectionFeatureForCoordinate(coords, layerKey) {
  const color = colorForObservationLayer(layerKey);
  return {
    type: 'Feature',
    properties: { layer: layerKey, halo_color: color },
    geometry: { type: 'Point', coordinates: coords },
  };
}

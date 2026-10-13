import {
  CATEGORY_DRAW_ORDER,
  CASING_COLORS,
  LEGEND_SWATCH,
  categoryHighwayFilter,
  elevationFilter,
  widthExpression,
  casingWidthExpression,
  labelFilter,
  labelTextField,
} from '../lib/road-style-taxonomy.js?v=osm-turn-lane-guidance-v2';

export const DETAILED_SOURCE_ID = 'pintaz-detailed-roads';
export { LEGEND_SWATCH };

const PATH_CATEGORIES = new Set([
  'footway_path_track',
  'steps',
  'cycleway',
  'pedestrian',
  'corridor_elevator',
]);

const VEHICLE_DRAW_ORDER = CATEGORY_DRAW_ORDER.filter((c) => !PATH_CATEGORIES.has(c));
const PATH_DRAW_ORDER = CATEGORY_DRAW_ORDER.filter((c) => PATH_CATEGORIES.has(c));

function lineLayout(dash = null) {
  const layout = { 'line-join': 'round', 'line-cap': 'round' };
  if (dash) layout['line-dasharray'] = dash;
  return layout;
}

function paintForCategory(category, part, elevation) {
  const fillColor = LEGEND_SWATCH[category] || LEGEND_SWATCH.other;
  const casingColor = CASING_COLORS[category] || CASING_COLORS.other;
  const isPath = PATH_CATEGORIES.has(category);

  if (part === 'casing') {
    const bridgeBoost = elevation === 'bridge' ? 0.08 : 0;
    return {
      'line-color': casingColor,
      'line-width': casingWidthExpression(category),
      'line-opacity':
        elevation === 'tunnel' ? 0.55 + bridgeBoost : elevation === 'bridge' ? 0.98 : 0.85,
    };
  }

  const paint = {
    'line-color': fillColor,
    'line-width': widthExpression(category),
    'line-opacity': elevation === 'tunnel' ? 0.6 : elevation === 'bridge' ? 0.95 : 0.92,
  };

  if (elevation === 'tunnel') {
    paint['line-dasharray'] = [2, 1.5];
  } else if (category === 'construction') {
    paint['line-dasharray'] = [2.5, 2];
  } else if (category === 'steps') {
    paint['line-dasharray'] = [0.5, 1.2];
  } else if (isPath && category !== 'cycleway') {
    paint['line-dasharray'] = [1.8, 1.4];
  } else if (category === 'cycleway') {
    paint['line-dasharray'] = [2, 1];
  }

  return paint;
}

function layerId(elevation, category, part) {
  return `pintaz-road-${elevation}-${category}-${part}`;
}

function pushCategoryPair(layers, lineBase, elevation, category) {
  const filter = elevationFilter(elevation, categoryHighwayFilter(category));
  layers.push({
    ...lineBase,
    id: layerId(elevation, category, 'casing'),
    filter,
    layout: lineLayout(),
    paint: paintForCategory(category, 'casing', elevation),
  });
  layers.push({
    ...lineBase,
    id: layerId(elevation, category, 'fill'),
    filter,
    layout: lineLayout(),
    paint: paintForCategory(category, 'fill', elevation),
  });
}

export function detailedRoadLayerDefinitions() {
  const layers = [];
  const lineBase = {
    type: 'line',
    source: DETAILED_SOURCE_ID,
  };

  for (const elevation of ['tunnel', 'ground', 'bridge']) {
    for (const category of VEHICLE_DRAW_ORDER) {
      pushCategoryPair(layers, lineBase, elevation, category);
    }
  }

  for (const category of PATH_DRAW_ORDER) {
    pushCategoryPair(layers, lineBase, 'ground', category);
  }

  layers.push({
    id: 'pintaz-road-oneway',
    type: 'symbol',
    source: DETAILED_SOURCE_ID,
    filter: [
      'all',
      ['==', ['get', 'oneway'], 'yes'],
      [
        'in',
        ['get', 'highway'],
        [
          'literal',
          [
            'motorway',
            'motorway_link',
            'trunk',
            'trunk_link',
            'primary',
            'primary_link',
            'secondary',
            'secondary_link',
            'tertiary',
            'tertiary_link',
            'residential',
            'unclassified',
            'living_street',
            'service',
          ],
        ],
      ],
    ],
    minzoom: 16,
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 120,
      'text-field': '▶',
      'text-size': 11,
      'text-keep-upright': false,
      'text-rotation-alignment': 'map',
    },
    paint: {
      'text-color': '#475569',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1,
    },
  });

  layers.push({
    id: 'pintaz-road-label',
    type: 'symbol',
    source: DETAILED_SOURCE_ID,
    filter: labelFilter(),
    minzoom: 15,
    layout: {
      'symbol-placement': 'line',
      'text-field': labelTextField(),
      'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 17, 12, 19, 13],
      'text-max-angle': 28,
      'text-padding': 4,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
    },
    paint: {
      'text-color': '#334155',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.25,
      'text-opacity': 0.9,
    },
  });

  layers.push({
    ...lineBase,
    id: 'pintaz-road-highlight',
    filter: ['==', ['get', 'osm_id'], ''],
    paint: {
      'line-color': '#0ea5e9',
      'line-width': 7,
      'line-opacity': 0.88,
    },
  });

  return layers;
}

export const LABEL_LAYER_ID = 'pintaz-road-label';
export const ONEWAY_LAYER_ID = 'pintaz-road-oneway';
export const HIGHLIGHT_LAYER_ID = 'pintaz-road-highlight';

export const DETAILED_FILL_LAYER_IDS = detailedRoadLayerDefinitions()
  .filter((l) => l.type === 'line' && l.id.endsWith('-fill'))
  .map((l) => l.id);

export const DETAILED_LAYER_IDS = detailedRoadLayerDefinitions()
  .filter((l) => l.type === 'line' && l.id !== HIGHLIGHT_LAYER_ID)
  .map((l) => l.id);

export const PATH_LAYER_IDS = DETAILED_LAYER_IDS.filter((id) =>
  /ground-(footway_path_track|steps|cycleway|pedestrian|corridor_elevator)-/.test(id)
);

export const FIRST_DETAILED_ROAD_LAYER_ID = layerId('tunnel', VEHICLE_DRAW_ORDER[0], 'casing');

export function expectedLayerIdOrder() {
  const ids = [];
  for (const elevation of ['tunnel', 'ground', 'bridge']) {
    for (const category of VEHICLE_DRAW_ORDER) {
      ids.push(layerId(elevation, category, 'casing'));
      ids.push(layerId(elevation, category, 'fill'));
    }
  }
  for (const category of PATH_DRAW_ORDER) {
    ids.push(layerId('ground', category, 'casing'));
    ids.push(layerId('ground', category, 'fill'));
  }
  ids.push(ONEWAY_LAYER_ID, LABEL_LAYER_ID, HIGHLIGHT_LAYER_ID);
  return ids;
}

/** @typedef {'motorway_trunk'|'primary'|'secondary'|'tertiary'|'local'|'service'|'pedestrian'|'footway_path_track'|'cycleway'|'steps'|'construction'|'corridor_elevator'|'other'} RoadCategory */

export const KNOWN_HIGHWAYS = [
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
  'living_street',
  'unclassified',
  'service',
  'pedestrian',
  'footway',
  'path',
  'track',
  'cycleway',
  'steps',
  'construction',
  'corridor',
  'elevator',
];

const CATEGORY_HIGHWAYS = {
  motorway_trunk: ['motorway', 'motorway_link', 'trunk', 'trunk_link'],
  primary: ['primary', 'primary_link'],
  secondary: ['secondary', 'secondary_link'],
  tertiary: ['tertiary', 'tertiary_link'],
  local: ['residential', 'living_street', 'unclassified'],
  service: ['service'],
  pedestrian: ['pedestrian'],
  footway_path_track: ['footway', 'path', 'track'],
  cycleway: ['cycleway'],
  steps: ['steps'],
  construction: ['construction'],
  corridor_elevator: ['corridor', 'elevator'],
};

/** Draw order: bottom → top (within same elevation). */
export const CATEGORY_DRAW_ORDER = [
  'footway_path_track',
  'steps',
  'cycleway',
  'pedestrian',
  'corridor_elevator',
  'service',
  'local',
  'tertiary',
  'secondary',
  'primary',
  'motorway_trunk',
  'construction',
  'other',
];

export const LEGEND_SWATCH = {
  motorway_trunk: '#e8944a',
  primary: '#e8c84a',
  secondary: '#6b9fd4',
  tertiary: '#5fada6',
  local: '#e2e6eb',
  service: '#8fa3b8',
  footway_path_track: '#9a8570',
  pedestrian: '#a89888',
  cycleway: '#5da86a',
  steps: '#6b6b6b',
  construction: '#a78bc4',
  other: '#9ca3af',
};

export const CASING_COLORS = {
  motorway_trunk: '#9a4a18',
  primary: '#9a7a22',
  secondary: '#3d5f8a',
  tertiary: '#3a6f6a',
  local: '#7a828c',
  service: '#5c6d7d',
  footway_path_track: '#6b5d4d',
  pedestrian: '#7a6e62',
  cycleway: '#3d7348',
  steps: '#4a4a4a',
  construction: '#6d5a8a',
  corridor_elevator: '#6b7280',
  other: '#6b7280',
};

/** Zoom stops: [zoom, width] pairs for fill lines. */
export const WIDTH_STOPS = {
  motorway_trunk: [[13, 2.4], [15, 3.6], [17, 6.5], [19, 10]],
  primary: [[13, 2], [15, 3], [17, 5.5], [19, 8]],
  secondary: [[13, 1.6], [15, 2.4], [17, 4.5], [19, 7]],
  tertiary: [[13, 1.35], [15, 2], [17, 3.6], [19, 6]],
  local: [[13, 1.15], [15, 1.45], [17, 2.4], [19, 4]],
  service: [[13, 0.85], [15, 1.05], [17, 1.6], [19, 2.6]],
  pedestrian: [[13, 0.7], [15, 0.9], [17, 1.2], [19, 1.8]],
  footway_path_track: [[13, 0.55], [15, 0.75], [17, 1.05], [19, 1.5]],
  cycleway: [[13, 0.65], [15, 0.85], [17, 1.15], [19, 1.7]],
  steps: [[13, 0.5], [15, 0.65], [17, 0.95], [19, 1.3]],
  construction: [[13, 0.75], [15, 0.95], [17, 1.35], [19, 2]],
  corridor_elevator: [[13, 0.6], [15, 0.8], [17, 1.1], [19, 1.5]],
  other: [[13, 0.8], [15, 1], [17, 1.4], [19, 2]],
};

export function classifyHighway(highway) {
  if (!highway) return 'other';
  for (const [cat, list] of Object.entries(CATEGORY_HIGHWAYS)) {
    if (list.includes(highway)) return cat;
  }
  return 'other';
}

export function highwayInFilter(highways) {
  return ['in', ['get', 'highway'], ['literal', highways]];
}

export function categoryHighwayFilter(category) {
  if (category === 'other') {
    const known = Object.values(CATEGORY_HIGHWAYS).flat();
    return ['!', ['in', ['get', 'highway'], ['literal', known]]];
  }
  return highwayInFilter(CATEGORY_HIGHWAYS[category]);
}

export function isTunnelFilter() {
  return ['==', ['get', 'tunnel'], 'yes'];
}

export function isBridgeFilter() {
  return [
    'all',
    ['has', 'bridge'],
    ['!=', ['get', 'bridge'], ''],
    ['!=', ['get', 'bridge'], 'no'],
  ];
}

export function elevationFilter(elevation, categoryFilter) {
  if (elevation === 'tunnel') {
    return ['all', categoryFilter, isTunnelFilter()];
  }
  if (elevation === 'bridge') {
    return ['all', categoryFilter, isBridgeFilter()];
  }
  return [
    'all',
    categoryFilter,
    ['!', ['any', isTunnelFilter(), isBridgeFilter()]],
  ];
}

const WIDTH = (stops) => ['interpolate', ['linear'], ['zoom'], ...stops.flat()];

function stopsWithLanesBoost(stops) {
  return stops.map(([zoom, width]) => [
    zoom,
    [
      'case',
      ['>', ['to-number', ['coalesce', ['get', 'lanes'], '0']], 1],
      ['+', width, ['*', 0.32, ['-', ['to-number', ['coalesce', ['get', 'lanes'], '0']], 1]]],
      width,
    ],
  ]);
}

/**
 * Deterministic width: class base at each zoom, with a modest lanes boost when lanes > 1.
 * Mapbox GL rejects `+`/`case` wrapping a full interpolate, so boosts use per-stop literals.
 */
export function widthExpression(category) {
  const stops = WIDTH_STOPS[category] || WIDTH_STOPS.other;
  return WIDTH(stopsWithLanesBoost(stops));
}

export function casingWidthExpression(category) {
  const stops = WIDTH_STOPS[category] || WIDTH_STOPS.other;
  const bump = category === 'motorway_trunk' || category === 'primary' ? 1.6 : 1.1;
  const bumped = stops.map(([zoom, width]) => [zoom, width + bump]);
  return WIDTH(stopsWithLanesBoost(bumped));
}

export function labelTextField() {
  return ['coalesce', ['get', 'name'], ['get', 'ref']];
}

export function labelFilter() {
  return [
    'any',
    ['all', ['has', 'name'], ['!=', ['get', 'name'], '']],
    ['all', ['has', 'ref'], ['!=', ['get', 'ref'], '']],
  ];
}

const PATH_CATEGORIES = new Set([
  'footway_path_track',
  'steps',
  'cycleway',
  'pedestrian',
  'corridor_elevator',
]);

const VEHICLE_DRAW_ORDER = CATEGORY_DRAW_ORDER.filter((c) => !PATH_CATEGORIES.has(c));
const PATH_DRAW_ORDER = CATEGORY_DRAW_ORDER.filter((c) => PATH_CATEGORIES.has(c));

export function layerOrderKeys() {
  const keys = [];
  for (const elevation of ['tunnel', 'ground', 'bridge']) {
    for (const category of VEHICLE_DRAW_ORDER) {
      keys.push(`${elevation}:${category}:casing`);
      keys.push(`${elevation}:${category}:fill`);
    }
  }
  for (const category of PATH_DRAW_ORDER) {
    keys.push(`ground:${category}:casing`);
    keys.push(`ground:${category}:fill`);
  }
  keys.push('oneway', 'labels', 'highlight');
  return keys;
}

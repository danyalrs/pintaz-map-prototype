/** Highway values treated as motor-vehicle drivable for lane-baseline audit (display overlay may still draw paths). */
export const VEHICLE_HIGHWAY_TYPES = new Set([
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
  'unclassified',
  'residential',
  'service',
  'living_street',
  'road',
]);

export const NON_DRIVING_HIGHWAY_TYPES = new Set([
  'footway',
  'path',
  'cycleway',
  'pedestrian',
  'steps',
  'corridor',
  'elevator',
  'track',
  'construction',
]);

export const CATEGORY_WIDTH = {
  motorway: 12,
  trunk: 10,
  primary: 9,
  secondary: 8,
  tertiary: 7,
  residential: 6,
  service: 5,
  unclassified: 6,
};

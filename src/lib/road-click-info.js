const ROAD_INFO_KEYS = [
  'osm_id',
  'highway',
  'name',
  'ref',
  'lanes',
  'maxspeed',
  'surface',
  'oneway',
  'bridge',
  'tunnel',
  'access',
  'service',
];

export function formatRoadInfo(props) {
  if (!props) return 'Click a road on the map.';
  const lines = [];
  for (const k of ROAD_INFO_KEYS) {
    const v = props[k];
    const display = v != null && String(v).trim() !== '' ? String(v) : 'Not provided';
    lines.push(`${k}: ${display}`);
  }
  return lines.join('\n');
}

export { ROAD_INFO_KEYS };

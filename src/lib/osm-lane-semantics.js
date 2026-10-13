/** OSM lane-related semantic tags copied from the protected local PBF extract. */
export const OSM_LANE_SEMANTIC_TAG_KEYS = [
  'lanes:forward',
  'lanes:backward',
  'lanes:both_ways',
  'turn:lanes',
  'turn:lanes:forward',
  'turn:lanes:backward',
];

export const OSM_ROAD_SEMANTIC_TAG_KEYS = ['maxspeed', 'surface', 'bridge', 'tunnel'];

export const OSM_SEMANTIC_TAG_KEYS = [...OSM_LANE_SEMANTIC_TAG_KEYS, ...OSM_ROAD_SEMANTIC_TAG_KEYS];

export function propTag(props, key) {
  if (!props) return null;
  if (props[key] != null && props[key] !== '') return String(props[key]);
  const alt = key.replace(/:/g, '_');
  if (props[alt] != null && props[alt] !== '') return String(props[alt]);
  return null;
}

/** Turn-lane tag → human-readable pipe-separated movements (raw string preserved separately). */
export function formatTurnLanesDisplay(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw);
  return s
    .split('|')
    .map((lane) =>
      lane
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .join(' / ')
    )
    .join(' | ');
}

/** Props for lane-count interpretation only — directional tags are display-only enrichment. */
export function propsForLaneCountInterpretation(props) {
  if (!props) return {};
  const p = { ...props };
  for (const key of OSM_LANE_SEMANTIC_TAG_KEYS) {
    delete p[key];
    delete p[key.replace(/:/g, '_')];
  }
  return p;
}

export function hasUsableOsmLaneCount(derived) {
  if (!derived) return false;
  return (
    derived.lane_count_source === 'osm_lanes_total' ||
    derived.lane_count_source === 'osm_directional_tags'
  );
}

export function collectOsmSemantics(props) {
  const raw = {};
  for (const key of OSM_SEMANTIC_TAG_KEYS) {
    const v = propTag(props, key);
    if (v != null) raw[key] = v;
  }
  const display = {};
  for (const key of OSM_LANE_SEMANTIC_TAG_KEYS) {
    if (raw[key]) display[key] = formatTurnLanesDisplay(raw[key]);
  }
  return { raw, display };
}

export function formatSemanticPanelLines(props, derived) {
  if (!hasUsableOsmLaneCount(derived)) return [];
  const { raw, display } = collectOsmSemantics(props);
  const lines = [];
  const line = (label, value) => {
    lines.push(`${label}: ${value ?? 'Not provided'}`);
  };

  line('lanes:forward', raw['lanes:forward']);
  line('lanes:backward', raw['lanes:backward']);
  line('lanes:both_ways', raw['lanes:both_ways']);

  for (const key of ['turn:lanes', 'turn:lanes:forward', 'turn:lanes:backward']) {
    line(key, raw[key]);
    if (raw[key] && display[key]) {
      lines.push(`${key} (display): ${display[key]}`);
    }
  }

  line('maxspeed', raw.maxspeed);
  line('surface', raw.surface);
  line('bridge', raw.bridge);
  line('tunnel', raw.tunnel);

  return lines;
}

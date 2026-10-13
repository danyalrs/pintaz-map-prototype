import { parsePositiveInt, parseWidthMetres, parseOneway } from './lane-tag-parse.js';

const TAGS = [
  'lanes',
  'lanes:forward',
  'lanes:backward',
  'lanes:both_ways',
  'width',
  'oneway',
  'highway',
  'turn:lanes',
  'turn:lanes:forward',
  'turn:lanes:backward',
  'bridge',
  'tunnel',
];

function bump(bucket, kind) {
  bucket[kind] = (bucket[kind] || 0) + 1;
}

function prop(props, key) {
  if (props[key] != null) return props[key];
  return props[key.replace(/:/g, '_')];
}

export function auditOsmRoadFeatures(features) {
  const summary = {
    feature_count: features.length,
    tags: {},
    lanes_value_breakdown: {},
    width_value_breakdown: {},
    highway_counts: {},
  };

  for (const tag of TAGS) {
    summary.tags[tag] = {
      present: 0,
      missing: 0,
      valid_numeric: 0,
      invalid: 0,
      conditional_or_multiple: 0,
      outlier: 0,
      other: 0,
    };
  }

  for (const f of features) {
    const p = f.properties || {};
    if (p.highway) summary.highway_counts[p.highway] = (summary.highway_counts[p.highway] || 0) + 1;

    for (const tag of TAGS) {
      const raw = prop(p, tag);
      const bucket = summary.tags[tag];
      if (raw == null || String(raw).trim() === '') {
        bump(bucket, 'missing');
        continue;
      }
      bump(bucket, 'present');
      if (tag === 'lanes' || tag.startsWith('lanes:')) {
        const parsed = parsePositiveInt(raw);
        bump(bucket, parsed.kind);
        summary.lanes_value_breakdown[tag] = summary.lanes_value_breakdown[tag] || {};
        bump(summary.lanes_value_breakdown[tag], parsed.kind);
      } else if (tag === 'width') {
        const parsed = parseWidthMetres(raw);
        bump(bucket, parsed.kind);
        summary.width_value_breakdown[parsed.kind] = (summary.width_value_breakdown[parsed.kind] || 0) + 1;
      } else if (tag === 'oneway') {
        parseOneway(raw);
        bump(bucket, 'other');
      } else {
        bump(bucket, 'other');
      }
    }
  }

  summary.lanes_tag_present_count = summary.tags.lanes.present;
  return summary;
}

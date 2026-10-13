import { parsePositiveInt, parseWidthMetres, parseOneway } from './lane-tag-parse.js';

/** Documented prototype display lane width — not an OSM measurement. */
export const DISPLAY_LANE_WIDTH_M = 3.2;

const LANE_PROP_KEYS = {
  lanes: 'lanes',
  forward: 'lanes:forward',
  backward: 'lanes:backward',
  both: 'lanes:both_ways',
};

function prop(props, key) {
  if (props[key] != null) return props[key];
  const alt = key.replace(/:/g, '_');
  return props[alt];
}

export function interpretOsmRoadProperties(props, highwayCategoryWidthM = 5) {
  const lanes = parsePositiveInt(prop(props, LANE_PROP_KEYS.lanes));
  const fwd = parsePositiveInt(prop(props, LANE_PROP_KEYS.forward));
  const bwd = parsePositiveInt(prop(props, LANE_PROP_KEYS.backward));
  const both = parsePositiveInt(prop(props, LANE_PROP_KEYS.both));
  const width = parseWidthMetres(props.width);
  const oneway = parseOneway(props.oneway);

  let lane_count_forward = null;
  let lane_count_backward = null;
  let lane_count_both_ways = both.kind === 'valid_numeric' ? both.value : null;
  let lane_count_total = null;
  let lane_count_source = 'lane_count_unknown';
  let direction_confidence = 'unknown';
  let unknown_reason = 'no_usable_lane_tags';
  let disagreement = null;

  const hasDirectional =
    fwd.kind === 'valid_numeric' ||
    bwd.kind === 'valid_numeric' ||
    both.kind === 'valid_numeric';

  if (hasDirectional) {
    lane_count_forward = fwd.kind === 'valid_numeric' ? fwd.value : 0;
    lane_count_backward = bwd.kind === 'valid_numeric' ? bwd.value : 0;
    lane_count_total = lane_count_forward + lane_count_backward + (lane_count_both_ways ?? 0);
    lane_count_source = 'osm_directional_tags';
    direction_confidence = 'directional_tags';
    unknown_reason = null;
    if (lanes.kind === 'valid_numeric' && lanes.value !== lane_count_total) {
      disagreement = `lanes=${lanes.value} differs from directional sum=${lane_count_total}`;
    }
  } else if (lanes.kind === 'valid_numeric') {
    lane_count_total = lanes.value;
    lane_count_source = 'osm_lanes_total';
    if (oneway.isOneway) {
      lane_count_forward = lanes.value;
      lane_count_backward = 0;
      direction_confidence = oneway.reverse ? 'oneway_reverse' : 'oneway_forward';
      unknown_reason = null;
    } else {
      direction_confidence = 'total_only';
      unknown_reason = null;
    }
  } else if (lanes.kind === 'conditional_or_multiple') {
    lane_count_source = 'lane_count_unknown';
    unknown_reason = 'conditional_or_multiple_lanes_tag';
  } else if (lanes.kind === 'invalid' || lanes.kind === 'outlier') {
    lane_count_source = 'lane_count_unknown';
    unknown_reason = `invalid_lanes_tag:${lanes.kind}`;
  }

  let road_width_m = null;
  let road_width_source = 'category_display_default';
  let lane_width_m = null;

  if (width.kind === 'valid_metres' || width.kind === 'valid_feet_converted') {
    road_width_m = width.metres;
    road_width_source = 'osm_width';
    if (lane_count_total) lane_width_m = road_width_m / lane_count_total;
  } else if (lane_count_total) {
    road_width_m = lane_count_total * DISPLAY_LANE_WIDTH_M;
    road_width_source = 'lane_count_display_estimate';
    lane_width_m = DISPLAY_LANE_WIDTH_M;
  } else {
    road_width_m = highwayCategoryWidthM;
    road_width_source = 'category_display_default';
  }

  let geometry_confidence = 'unsupported';
  if (lane_count_total && lane_count_total >= 1) {
    geometry_confidence = direction_confidence === 'total_only' ? 'surface_and_dividers_total_only' : 'surface_and_dividers';
  } else if (road_width_source === 'osm_width') {
    geometry_confidence = 'surface_only';
  } else {
    geometry_confidence = 'line_only_unknown_lanes';
  }

  return {
    lane_count_total,
    lane_count_forward,
    lane_count_backward,
    lane_count_both_ways,
    lane_count_source,
    direction_confidence,
    road_width_m,
    road_width_source,
    lane_width_m,
    geometry_confidence,
    unknown_reason,
    disagreement,
    oneway,
    lanes_raw: lanes,
    width_raw: width,
  };
}

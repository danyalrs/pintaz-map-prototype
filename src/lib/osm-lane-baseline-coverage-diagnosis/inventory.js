import { parsePositiveInt, parseOneway } from '../lane-tag-parse.js';
import { interpretOsmRoadProperties } from '../lane-interpret.js';
import { lineLengthM, dedupeCoordinates } from '../lane-geometry.js';
import { CATEGORY_WIDTH, VEHICLE_HIGHWAY_TYPES, NON_DRIVING_HIGHWAY_TYPES } from './constants.js';

function prop(props, key) {
  if (props[key] != null) return props[key];
  return props[key.replace(/:/g, '_')];
}

function redactOsmId(id) {
  const s = String(id ?? '');
  if (s.length <= 4) return `osm_${s}`;
  return `osm_…${s.slice(-4)}`;
}

export function buildOsmRoadInventory(features) {
  const totals = {
    feature_count: features.length,
    linestrings: 0,
    explicit_lanes_tag: 0,
    directional_lane_tags_only: 0,
    conflicting_lane_tags: 0, // lanes total vs directional sum
    malformed_lane_values: 0,
    no_lane_information: 0,
    oneway_yes: 0,
    oneway_reverse: 0,
    two_way_assumed: 0,
    vehicle_eligible: 0,
    non_driving_included: 0,
    unknown_highway: 0,
    with_width_tag: 0,
    divided_carriageway_hint: 0,
    eligible_excluded_from_baseline: 0,
  };

  const records = [];
  const malformedExamples = [];

  for (const f of features) {
    const p = f.properties || {};
    const lanes = parsePositiveInt(prop(p, 'lanes'));
    const fwd = parsePositiveInt(prop(p, 'lanes:forward'));
    const bwd = parsePositiveInt(prop(p, 'lanes:backward'));
    const both = parsePositiveInt(prop(p, 'lanes:both_ways'));
    const oneway = parseOneway(p.oneway);
    const hw = p.highway;
    const catW = CATEGORY_WIDTH[hw] ?? 6;
    const interp = interpretOsmRoadProperties(p, catW);

    if (f.geometry?.type === 'LineString') totals.linestrings += 1;

    const hasExplicitLanes = lanes.kind === 'valid_numeric';
    const hasDirectional =
      fwd.kind === 'valid_numeric' || bwd.kind === 'valid_numeric' || both.kind === 'valid_numeric';

    if (hasExplicitLanes) totals.explicit_lanes_tag += 1;
    else if (hasDirectional) totals.directional_lane_tags_only += 1;
    else if (lanes.kind === 'conditional_or_multiple' || fwd.kind === 'conditional_or_multiple') {
      totals.malformed_lane_values += 1;
      if (malformedExamples.length < 5) malformedExamples.push(redactOsmId(p.osm_id));
    } else if (lanes.kind === 'invalid' || lanes.kind === 'outlier') {
      totals.malformed_lane_values += 1;
    } else totals.no_lane_information += 1;

    if (interp.disagreement) totals.conflicting_lane_tags += 1;

    if (oneway.isOneway && !oneway.reverse) totals.oneway_yes += 1;
    else if (oneway.isOneway && oneway.reverse) totals.oneway_reverse += 1;
    else totals.two_way_assumed += 1;

    const vehicleEligible = VEHICLE_HIGHWAY_TYPES.has(hw);
    if (vehicleEligible) totals.vehicle_eligible += 1;
    else if (NON_DRIVING_HIGHWAY_TYPES.has(hw)) totals.non_driving_included += 1;
    else totals.unknown_highway += 1;

    if (prop(p, 'width')) totals.with_width_tag += 1;
    if (p.dual_carriageway === 'yes' || p['dual:carriageway'] === 'yes') totals.divided_carriageway_hint += 1;

    let coords = [];
    let lengthM = 0;
    if (f.geometry?.type === 'LineString') {
      coords = dedupeCoordinates(f.geometry.coordinates);
      lengthM = lineLengthM(coords);
    }

    const record = {
      osm_ref: redactOsmId(p.osm_id),
      geometry_type: f.geometry?.type ?? null,
      highway: hw ?? null,
      name: p.name ? String(p.name).slice(0, 48) : null,
      oneway: p.oneway ?? null,
      junction: p.junction ?? null,
      bridge: p.bridge ?? null,
      tunnel: p.tunnel ?? null,
      layer: p.layer ?? null,
      lanes: prop(p, 'lanes') ?? null,
      lanes_forward: prop(p, 'lanes:forward') ?? null,
      lanes_backward: prop(p, 'lanes:backward') ?? null,
      lanes_both_ways: prop(p, 'lanes:both_ways') ?? null,
      width: p.width ?? null,
      turn_lanes: prop(p, 'turn:lanes') ?? null,
      access: p.access ?? null,
      service: p.service ?? null,
      length_m: Math.round(lengthM * 100) / 100,
      vehicle_road_eligible: vehicleEligible,
      lane_count_total: interp.lane_count_total,
      lane_count_source: interp.lane_count_source,
    };

    records.push(record);
  }

  totals.eligible_excluded_from_baseline = totals.vehicle_eligible;

  return { totals, records, malformed_examples: malformedExamples };
}

export function summarizeInventoryForMarkdown(totals) {
  return totals;
}

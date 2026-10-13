import { interpretOsmRoadProperties } from '../lane-interpret.js';
import { CATEGORY_WIDTH } from './constants.js';

function prop(props, key) {
  if (props[key] != null) return props[key];
  return props[key.replace(/:/g, '_')];
}

function redactOsmId(id) {
  const s = String(id ?? '');
  if (s.length <= 4) return `osm_${s}`;
  return `osm_…${s.slice(-4)}`;
}

/**
 * Audit interpretOsmRoadProperties against documented lane semantics.
 */
export function auditLaneResolution(features) {
  const branches = {
    osm_directional_tags: 0,
    osm_lanes_total_oneway: 0,
    osm_lanes_total_two_way: 0,
    lane_count_unknown: 0,
    conditional_or_multiple: 0,
    invalid_lanes: 0,
  };

  const violations = [];
  const ambiguous = [];

  for (const f of features) {
    if (f.geometry?.type !== 'LineString') continue;
    const p = f.properties || {};
    const hw = p.highway;
    const catW = CATEGORY_WIDTH[hw] ?? 6;
    const interp = interpretOsmRoadProperties(p, catW);
    const lanesRaw = prop(p, 'lanes');
    const fwdRaw = prop(p, 'lanes:forward');
    const bwdRaw = prop(p, 'lanes:backward');

    if (interp.lane_count_source === 'osm_directional_tags') branches.osm_directional_tags += 1;
    else if (interp.lane_count_source === 'osm_lanes_total' && interp.oneway.isOneway) branches.osm_lanes_total_oneway += 1;
    else if (interp.lane_count_source === 'osm_lanes_total') branches.osm_lanes_total_two_way += 1;
    else if (interp.unknown_reason === 'conditional_or_multiple_lanes_tag') branches.conditional_or_multiple += 1;
    else if (String(interp.unknown_reason || '').startsWith('invalid_lanes_tag')) branches.invalid_lanes += 1;
    else branches.lane_count_unknown += 1;

    if (interp.disagreement) {
      ambiguous.push({
        osm_ref: redactOsmId(p.osm_id),
        issue: 'lanes_total_vs_directional_sum',
        detail: interp.disagreement,
      });
    }

    // Two-way total-only: forward/back must stay null (not doubled).
    if (interp.lane_count_source === 'osm_lanes_total' && !interp.oneway.isOneway) {
      if (interp.lane_count_forward != null || interp.lane_count_backward != null) {
        violations.push({
          osm_ref: redactOsmId(p.osm_id),
          rule: 'no_auto_split_on_two_way_total_lanes',
          forward: interp.lane_count_forward,
          backward: interp.lane_count_backward,
        });
      }
    }

    // Oneway: all lanes should be assigned to forward direction in model.
    if (interp.lane_count_source === 'osm_lanes_total' && interp.oneway.isOneway) {
      if (interp.lane_count_forward !== interp.lane_count_total) {
        violations.push({
          osm_ref: redactOsmId(p.osm_id),
          rule: 'oneway_lanes_in_way_direction',
          forward: interp.lane_count_forward,
          total: interp.lane_count_total,
        });
      }
    }
  }

  return {
    branch_counts: branches,
    violations,
    ambiguous_lane_tag_conflicts: ambiguous,
    violation_count: violations.length,
  };
}

export function expectedDividerCount(laneCount, directionConfidence) {
  if (!laneCount || laneCount < 2) return 0;
  if (directionConfidence === 'total_only') {
    let count = 0;
    if (laneCount % 2 === 1) count += 1;
    const half = Math.floor(laneCount / 2);
    count += half * 2;
    return count;
  }
  return laneCount - 1;
}

import fs from 'node:fs';
import { localAreaGeojsonPath } from '../local-areas.js';
import { COMPARISON_AREA_ID } from '../comparison-paths.js';
import { buildOsmSegmentIndex } from '../osm-segment-index.js';
import { matchVehiclePoses, sortPoses } from '../vehicle-osm-matcher.js';
import { normalizeOsmWayId } from '../selected-route-osm-comparison-lookup.js';
import { WAY_COVERAGE_CLASS, QUALIFICATION } from './constants.js';

let _index = null;

export function osmMatcherIndex() {
  if (_index) return _index;
  const roads = JSON.parse(fs.readFileSync(localAreaGeojsonPath(COMPARISON_AREA_ID), 'utf8'));
  _index = buildOsmSegmentIndex(roads);
  return _index;
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function summarizeRoutePoseMatches(poses, unknownWayIds) {
  const index = osmMatcherIndex();
  const sorted = sortPoses(poses);
  const { matches } = matchVehiclePoses(sorted, index, { searchRadiusM: 15 });
  const unknownSet = new Set(unknownWayIds);
  const byWay = new Map();

  for (const m of matches) {
    const wayId = normalizeOsmWayId(m.properties?.osm_id);
    if (!unknownSet.has(wayId)) continue;
    if (!byWay.has(wayId)) {
      byWay.set(wayId, {
        osm_way_id: wayId,
        matched_pose_count: 0,
        distances: [],
        headings: [],
        direction_ok: 0,
        along_segments: [],
      });
    }
    const row = byWay.get(wayId);
    row.matched_pose_count += 1;
    row.distances.push(m.properties.distance_m ?? 99);
    row.headings.push(m.properties.heading_diff_deg ?? 90);
    if ((m.properties.heading_diff_deg ?? 99) <= QUALIFICATION.maxMedianHeadingDiffDeg) row.direction_ok += 1;
    if (m.properties.along_segment_m != null) row.along_segments.push(m.properties.along_segment_m);
  }

  const wayRows = [];
  for (const row of byWay.values()) {
    const along = row.along_segments.sort((a, b) => a - b);
    let continuous_m = 0;
    if (along.length >= 2) continuous_m = Math.max(0, along[along.length - 1] - along[0]);
    wayRows.push({
      osm_way_id: row.osm_way_id,
      matched_pose_count: row.matched_pose_count,
      median_distance_m: median(row.distances),
      median_heading_diff_deg: median(row.headings),
      direction_compatible_fraction: row.matched_pose_count
        ? row.direction_ok / row.matched_pose_count
        : 0,
      continuous_covered_length_m: continuous_m,
    });
  }
  return { wayRows, total_matched_poses: matches.length };
}

export function classifyWayCoverage(row) {
  if (!row || row.matched_pose_count < 1) return WAY_COVERAGE_CLASS.NONE;
  const qualityOk =
    row.matched_pose_count >= QUALIFICATION.minPosesOnWay &&
    (row.median_distance_m ?? 99) <= QUALIFICATION.minMedianDistanceM &&
    (row.median_heading_diff_deg ?? 180) <= QUALIFICATION.maxMedianHeadingDiffDeg;
  if (!qualityOk) return WAY_COVERAGE_CLASS.LOW;
  return WAY_COVERAGE_CLASS.CANDIDATE;
}

export function rankRouteRoadPairs(allRouteWayRows) {
  const scored = allRouteWayRows.map((r) => {
    let score =
      r.matched_pose_count * 2 +
      (r.continuous_covered_length_m ?? 0) / 10 +
      (r.direction_compatible_fraction ?? 0) * 5 -
      (r.median_distance_m ?? 0) * 0.2 -
      (r.median_heading_diff_deg ?? 0) * 0.05;
    return { ...r, ranking_score: Math.round(score * 100) / 100 };
  });
  scored.sort((a, b) => b.ranking_score - a.ranking_score);
  const topIds = new Set(scored.slice(0, 5).map((s) => `${s.route_ref}|${s.osm_way_id}`));
  return scored.map((s) => ({
    ...s,
    coverage_class:
      topIds.has(`${s.route_ref}|${s.osm_way_id}`)
        ? WAY_COVERAGE_CLASS.RANKED
        : classifyWayCoverage(s),
  }));
}

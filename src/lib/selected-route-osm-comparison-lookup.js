import fs from 'node:fs';
import { routeComparisonDir } from './local-route-explorer/paths.js';
import { roadSectionsPath, matchedPosesPath } from './comparison-paths.js';
import { roadIndexPath } from './lane-baseline-paths.js';
import { DEFAULT_LOCAL_AREA_ID } from './local-areas.js';
import { observationRouteSpec } from './local-route-explorer/config.js';
import { isActionableProposal } from './comparison-ui-groups.js';
import { loadProposalDecisions } from './comparison-decisions.js';
import { supportGatesFailed } from './mismatch-eligibility.js';
import { auditResultFromSectionProperties } from './comparison-section-audit-result.js';

function loadJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Normalize OSM way ids from GeoJSON / MapLibre (numeric, string, or float-shaped). */
export function normalizeOsmWayId(osmId) {
  if (osmId == null || osmId === '') return '';
  const raw = String(osmId).trim();
  if (/^\d+(\.0+)?$/.test(raw)) return String(Math.trunc(Number(raw)));
  return raw;
}

function osmIdFromFeatureProperties(properties) {
  return normalizeOsmWayId(properties?.osm_id);
}

function posesByOsm(matchedGeo) {
  const m = new Map();
  for (const f of matchedGeo?.features || []) {
    const id = String(f.properties?.osm_id);
    if (!id) continue;
    if (!m.has(id)) m.set(id, []);
    m.get(id).push(f);
  }
  return m;
}

export function aggregateWayFromSections(sections) {
  if (!sections.length) return null;
  const obs = {
    vehicle_frames: 0,
    lane_observations: 0,
    edge_observations: 0,
    gps_observations: 0,
  };
  let best = null;
  const rank = (r) =>
    ({ mismatch_candidate: 4, alignment_consistent: 3, insufficient_evidence: 2, not_evaluated: 1 }[r] || 0);
  for (const s of sections) {
    const p = s.properties || {};
    obs.vehicle_frames += p.vehicle_frames || 0;
    obs.lane_observations += p.lane_observations || 0;
    obs.edge_observations += p.edge_observations || 0;
    obs.gps_observations += p.gps_observations || 0;
    const ar = auditResultFromSectionProperties(p);
    if (!best || rank(ar.result) > rank(best.result)) best = ar;
    if (ar.result === 'mismatch_candidate') best = ar;
  }
  const supportFails = supportGatesFailed({
    frame_count: obs.vehicle_frames,
    section_length_m: sections.reduce((m, s) => Math.max(m, s.properties?.section_length_m || 0), 0),
    median_heading_diff_deg: sections[0]?.properties?.median_heading_diff_deg,
    lane_edge_eligible: obs.lane_observations > 0,
    unmatched_divider_rate: 0,
  });
  if (best.result === 'alignment_consistent' && supportFails.length) {
    best = { result: 'insufficient_evidence', first_failed_gate: supportFails[0], matched_compared: true };
  }
  return { ...best, observation_counts: obs, section_count: sections.length };
}

function osmLaneFields(indexEntry) {
  if (!indexEntry || indexEntry.lane_count_source === 'lane_count_unknown') {
    return {
      osm_lane_count: null,
      osm_lane_count_label: 'Lane count unknown',
      osm_lanes_tag: indexEntry?.osm_lanes ?? null,
    };
  }
  const total = indexEntry.lane_count_total;
  if (total != null && Number(total) > 0) {
    return {
      osm_lane_count: total,
      osm_lane_count_label: String(total),
      osm_lanes_tag: indexEntry.osm_lanes ?? String(total),
    };
  }
  return {
    osm_lane_count: null,
    osm_lane_count_label: 'Not provided',
    osm_lanes_tag: indexEntry?.osm_lanes ?? null,
  };
}

function proposalStatusForSections(routeKey, sections, comparisonResult) {
  if (routeKey !== 'active') {
    return 'Diagnostic route — no production proposal';
  }
  if (comparisonResult === 'alignment_consistent') {
    return 'No production proposal — OSM baseline agrees';
  }
  const eligible = sections.filter(
    (s) => s.properties?.proposal_eligible && isActionableProposal(s.properties?.classification)
  );
  if (!eligible.length) {
    return 'No production proposal';
  }
  const decisions = loadProposalDecisions();
  const id = eligible[0].properties?.proposal_id;
  const state = decisions.decisions[id]?.state ?? 'pending';
  return state.charAt(0).toUpperCase() + state.slice(1);
}

/**
 * Read-only per-way comparison slice from existing comparison-v1 outputs.
 */
export function lookupSelectedRouteOsmComparison(routeKey, osmId) {
  const spec = observationRouteSpec(routeKey);
  if (!spec) return { ok: false, error: 'unknown_route' };

  const compDir = routeComparisonDir(routeKey);
  const sectionsGeo = loadJson(roadSectionsPath(compDir));
  const comparison_available = Boolean(sectionsGeo?.features?.length);
  if (!comparison_available) {
    return { ok: true, comparison_available: false, route_key: routeKey };
  }

  const osmKey = normalizeOsmWayId(osmId);
  if (!osmKey) {
    return { ok: true, comparison_available: false, route_key: routeKey };
  }
  const sections = (sectionsGeo.features || []).filter((f) => osmIdFromFeatureProperties(f.properties) === osmKey);
  const matchedGeo = loadJson(matchedPosesPath(compDir));
  const poseMap = posesByOsm(matchedGeo);

  const roadIndex = loadJson(roadIndexPath(DEFAULT_LOCAL_AREA_ID));
  const indexEntry = roadIndex?.by_osm_id?.[osmKey] ?? null;
  const laneFields = osmLaneFields(indexEntry);
  const road_name =
    sections[0]?.properties?.name ||
    sections[0]?.properties?.road_name ||
    null;

  let comparison_result;
  let first_failed_gate;
  let observation_counts;
  let section_count;
  let matched_compared;

  if (sections.length) {
    const agg = aggregateWayFromSections(sections);
    comparison_result = agg.result;
    first_failed_gate = agg.first_failed_gate;
    observation_counts = agg.observation_counts;
    section_count = agg.section_count;
    matched_compared = agg.matched_compared;
  } else if (poseMap.has(osmKey)) {
    const poses = poseMap.get(osmKey);
    comparison_result = 'insufficient_evidence';
    first_failed_gate = 'no_comparison_section_grouped';
    observation_counts = {
      vehicle_frames: poses.length,
      lane_observations: 0,
      edge_observations: 0,
      gps_observations: 0,
    };
    section_count = 0;
    matched_compared = true;
  } else {
    comparison_result = 'not_evaluated';
    first_failed_gate = 'outside_observation_corridor_or_no_pose_match';
    observation_counts = {
      vehicle_frames: 0,
      lane_observations: 0,
      edge_observations: 0,
      gps_observations: 0,
    };
    section_count = 0;
    matched_compared = false;
  }

  const route_state_label =
    routeKey === 'active'
      ? 'Active route — production active'
      : 'Diagnostic local route — does not change production active source';

  return {
    ok: true,
    comparison_available: true,
    schema: 'pintaz.selected-route-osm-comparison.v1',
    route_key: routeKey,
    route_label: spec.option_label,
    route_state_label,
    diagnostic_only: routeKey !== 'active',
    osm_id: osmKey,
    road_name,
    ...laneFields,
    comparison_result,
    first_failed_gate,
    observation_counts,
    section_count,
    matched_compared,
    proposal_status: proposalStatusForSections(routeKey, sections, comparison_result),
  };
}

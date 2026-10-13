import fs from 'node:fs';
import path from 'node:path';
import { OBSERVATION_ROUTES } from '../local-route-explorer/config.js';
import { routeComparisonDir, derivedPreviewPath } from '../local-route-explorer/paths.js';
import {
  roadSectionsPath,
  matchedPosesPath,
  rejectedMatchesPath,
} from '../comparison-paths.js';
import { roadIndexPath } from '../lane-baseline-paths.js';
import { localAreaGeojsonPath, DEFAULT_LOCAL_AREA_ID } from '../local-areas.js';
import { isActionableProposal } from '../comparison-ui-groups.js';
import { aggregateWayFromSections } from '../selected-route-osm-comparison-lookup.js';
import { auditResultFromSectionProperties } from '../comparison-section-audit-result.js';

export { auditResultFromSectionProperties };

const USABLE_LANE_SOURCES = new Set(['osm_lanes_total', 'osm_directional_tags']);

export function isExplicitUsableLaneCount(entry) {
  if (!entry) return false;
  if (entry.lane_count_source === 'lane_count_unknown') return false;
  if (entry.lanes_raw?.kind === 'valid_numeric') return true;
  return USABLE_LANE_SOURCES.has(entry.lane_count_source) && Number(entry.lane_count_total) > 0;
}

function loadJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function buildRoadNameMap() {
  const roads = loadJson(localAreaGeojsonPath(DEFAULT_LOCAL_AREA_ID));
  const m = new Map();
  for (const f of roads?.features || []) {
    const id = String(f.properties?.osm_id);
    if (id) m.set(id, f.properties?.name || null);
  }
  return m;
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

export function runOsmFirstPerRouteComparisonAudit() {
  const roadIndex = loadJson(roadIndexPath(DEFAULT_LOCAL_AREA_ID));
  const names = buildRoadNameMap();
  const eligibleWays = [];
  for (const [osmId, entry] of Object.entries(roadIndex?.by_osm_id || {})) {
    if (!isExplicitUsableLaneCount(entry)) continue;
    eligibleWays.push({
      osm_id: osmId,
      road_name: names.get(osmId) || null,
      osm_lane_count: entry.lane_count_total,
      lane_count_source: entry.lane_count_source,
    });
  }
  eligibleWays.sort((a, b) => a.osm_id.localeCompare(b.osm_id));

  const routes = [];
  const mismatchCandidates = [];

  for (const spec of OBSERVATION_ROUTES) {
    const routeKey = spec.route_key;
    const compDir = routeComparisonDir(routeKey);
    const sectionsGeo = loadJson(roadSectionsPath(compDir));
    const matchedGeo = loadJson(matchedPosesPath(compDir));
    const rejectedGeo = loadJson(rejectedMatchesPath(compDir));
    const previewPath =
      routeKey === 'active'
        ? null
        : derivedPreviewPath(routeKey);
    const comparison_available = Boolean(sectionsGeo?.features?.length);
    const byOsmSections = new Map();
    for (const f of sectionsGeo?.features || []) {
      const id = String(f.properties?.osm_id);
      if (!byOsmSections.has(id)) byOsmSections.set(id, []);
      byOsmSections.get(id).push(f);
    }
    const poseMap = posesByOsm(matchedGeo);

    const wayRows = [];
    const totals = {
      alignment_consistent: 0,
      insufficient_evidence: 0,
      not_evaluated: 0,
      mismatch_candidate: 0,
      matched_compared: 0,
    };

    for (const way of eligibleWays) {
      const sections = byOsmSections.get(way.osm_id) || [];
      let row;
      if (sections.length) {
        const agg = aggregateWayFromSections(sections);
        row = {
          ...way,
          observation_counts: agg.observation_counts,
          matched_compared: true,
          result: agg.result,
          first_failed_gate: agg.first_failed_gate,
          section_count: agg.section_count,
          proposal_eligible_any: sections.some((s) => s.properties?.proposal_eligible),
        };
        totals.matched_compared += 1;
        totals[row.result] = (totals[row.result] || 0) + 1;
        if (row.result === 'mismatch_candidate') {
          mismatchCandidates.push({ route_key: routeKey, ...way, sections: sections.length });
        }
      } else if (poseMap.has(way.osm_id)) {
        const poses = poseMap.get(way.osm_id);
        row = {
          ...way,
          observation_counts: {
            vehicle_frames: poses.length,
            lane_observations: 0,
            edge_observations: 0,
            gps_observations: 0,
          },
          matched_compared: true,
          result: 'insufficient_evidence',
          first_failed_gate: 'no_comparison_section_grouped',
          section_count: 0,
          proposal_eligible_any: false,
        };
        totals.matched_compared += 1;
        totals.insufficient_evidence += 1;
      } else {
        row = {
          ...way,
          observation_counts: {
            vehicle_frames: 0,
            lane_observations: 0,
            edge_observations: 0,
            gps_observations: 0,
          },
          matched_compared: false,
          result: 'not_evaluated',
          first_failed_gate: 'outside_observation_corridor_or_no_pose_match',
          section_count: 0,
          proposal_eligible_any: false,
        };
        totals.not_evaluated += 1;
      }
      wayRows.push(row);
    }

    routes.push({
      route_key: routeKey,
      role: spec.role,
      diagnostic_only: routeKey !== 'active',
      comparison_output_dir: compDir,
      comparison_sections_available: comparison_available,
      rejected_pose_count: rejectedGeo?.features?.length ?? 0,
      matched_pose_count: matchedGeo?.features?.length ?? 0,
      eligible_osm_way_count: eligibleWays.length,
      totals,
      ways: wayRows,
      preview_derived_path: previewPath,
    });
  }

  return {
    schema: 'pintaz.osm-first-per-route-comparison-audit.v1',
    area_id: DEFAULT_LOCAL_AREA_ID,
    eligible_osm_way_definition:
      'road-index entries with valid numeric OSM lanes or osm_lanes_total/osm_directional_tags lane_count_source',
    eligible_osm_way_count: eligibleWays.length,
    routes,
    mismatch_candidates: mismatchCandidates,
    limitations: [],
  };
}

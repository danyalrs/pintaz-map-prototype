import { roadIndexPath } from '../lane-baseline-paths.js';
import { DEFAULT_LOCAL_AREA_ID } from '../local-areas.js';
import { attachObservationsToPoses, buildPoseLookup } from '../comparison-lane-attach.js';
import {
  DECISION,
  SOURCE_SEMANTICS_STATUS,
  HUMAN_REVIEW_REQUIRED,
  NEVER_AUTO_APPLY,
} from './constants.js';
import { SOURCE_SEMANTICS_AUDIT } from './source-semantics.js';
import {
  rejectFrameReason,
  detectSharpBend,
  detectIsolatedPose,
} from './frame-filter.js';
import { consensusFromHypotheses, laneCountHypothesesForFrame } from './hypothesis.js';
import { normalizeOsmWayId } from '../selected-route-osm-comparison-lookup.js';

function loadJson(fs, p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function isMissingOsmLanes(entry) {
  if (!entry) return true;
  if (entry.lane_count_source === 'lane_count_unknown') return true;
  if (entry.lanes_raw?.kind === 'valid_numeric') return false;
  return !(Number(entry.lane_count_total) > 0);
}

/**
 * Build one enrichment row for (route, osm way) from existing local bundles.
 */
export function buildWayRow({
  fs,
  routeKey,
  osmWayId,
  matchedPoses,
  previewFeatures,
  roadIndexEntry,
  roadName = null,
}) {
  const osmKey = normalizeOsmWayId(osmWayId);
  const osm_lane_count =
    roadIndexEntry?.lane_count_source === 'lane_count_unknown'
      ? null
      : roadIndexEntry?.lane_count_total ?? null;

  const base = {
    osm_way_id: osmKey,
    route_key: routeKey,
    road_name: roadName,
    osm_lane_count,
    source_semantics_status: SOURCE_SEMANTICS_STATUS.DOCUMENTED,
    matched_vehicle_frames: 0,
    accepted_frames: 0,
    rejected_frame_reasons: [],
    cross_section_candidates: [],
    lane_count_hypotheses: [],
    selected_lane_count: null,
    confidence: 0,
    decision: DECISION.INSUFFICIENT_EVIDENCE,
    human_review_required: HUMAN_REVIEW_REQUIRED,
    never_auto_apply: NEVER_AUTO_APPLY,
  };

  if (!isMissingOsmLanes(roadIndexEntry)) {
    return {
      ...base,
      decision: DECISION.OSM_BASELINE_PRESENT,
      source_semantics_status: SOURCE_SEMANTICS_STATUS.DOCUMENTED,
      note: 'OSM lanes tag / baseline lane count already present — no missing-lane enrichment target.',
    };
  }

  const posesOnWay = (matchedPoses || []).filter(
    (f) => normalizeOsmWayId(f.properties?.osm_id) === osmKey
  );
  base.matched_vehicle_frames = posesOnWay.length;
  if (!posesOnWay.length) {
    return { ...base, decision: DECISION.INSUFFICIENT_EVIDENCE, note: 'No matched vehicle poses on this OSM way.' };
  }

  const laneEdge = (previewFeatures || []).filter(
    (f) => f.properties?.layer === 'lane_point' || f.properties?.layer === 'edge_point'
  );
  const poseLookup = buildPoseLookup(posesOnWay);
  const { attached } = attachObservationsToPoses(laneEdge, poseLookup, new Map());

  const sharp = detectSharpBend(posesOnWay);
  const frameIds = [...new Set(posesOnWay.map((p) => p.properties.frame_id))];
  const accepted = [];
  const rejected = [];

  for (const fid of frameIds) {
    const framePoses = posesOnWay.filter((p) => p.properties.frame_id === fid);
    const pose = framePoses[0];
    const frameLane = attached.filter(
      (a) => a.properties.frame_id === fid && a.properties.layer === 'lane_point'
    );
    const frameEdge = attached.filter(
      (a) => a.properties.frame_id === fid && a.properties.layer === 'edge_point'
    );
    const reasons = rejectFrameReason(pose.properties, {
      sharp_bend: sharp,
      near_junction: false,
      missing_lane_edge: frameLane.length === 0 && frameEdge.length === 0,
      isolated_pose: detectIsolatedPose(pose, posesOnWay),
    });
    if (reasons.length) {
      rejected.push({ frame_id: fid, reasons });
      continue;
    }
    const hypothesis = laneCountHypothesesForFrame(frameLane);
    const crossSection = {
      frame_id: fid,
      lane_observation_points: frameLane.length,
      edge_observation_points: frameEdge.length,
      model_lane_line_slots: hypothesis.model_lane_line_slots,
      along_segment_m: pose.properties.along_segment_m,
      distance_m: pose.properties.distance_m,
      heading_diff_deg: pose.properties.heading_diff_deg,
    };
    accepted.push({ frame_id: fid, crossSection, hypothesis });
  }

  base.rejected_frame_reasons = rejected;
  base.accepted_frames = accepted.length;
  base.cross_section_candidates = accepted.map((a) => a.crossSection);
  base.lane_count_hypotheses = accepted.map((a) => ({
    frame_id: a.frame_id,
    ...a.hypothesis,
  }));

  if (!SOURCE_SEMANTICS_AUDIT.physical_lane_count_supported) {
    const consensus = consensusFromHypotheses(accepted.map((a) => a.hypothesis));
    return {
      ...base,
      ...consensus,
      decision: DECISION.UNSUPPORTED_SOURCE_SEMANTICS,
      note:
        'Source preview schema documents model lane line samples; cannot infer defensible physical lane count. Green dot count is not lane count.',
    };
  }

  const consensus = consensusFromHypotheses(accepted.map((a) => a.hypothesis));
  return {
    ...base,
    ...consensus,
    decision:
      consensus.selected_lane_count != null
        ? DECISION.REVIEW_CANDIDATE_MISSING_OSM_LANES
        : DECISION.INSUFFICIENT_EVIDENCE,
  };
}

export function loadRoadIndexEntry(fs, osmWayId, areaId = DEFAULT_LOCAL_AREA_ID) {
  const idx = loadJson(fs, roadIndexPath(areaId));
  return idx?.by_osm_id?.[normalizeOsmWayId(osmWayId)] ?? null;
}

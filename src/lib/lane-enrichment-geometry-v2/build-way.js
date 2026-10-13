import { normalizeOsmWayId } from '../selected-route-osm-comparison-lookup.js';
import { OUTCOME, HUMAN_REVIEW_REQUIRED, NEVER_AUTO_APPLY } from './constants.js';
import { isOneWayWay, selectCrossSections, EXCLUSION } from './cross-section.js';
import { collectFrameEvidence } from './frame-evidence.js';
import { clusterBoundaries } from './boundary-cluster.js';
import { deriveLaneHypothesis } from './hypothesis.js';

function missingOsmLanes(entry) {
  if (!entry) return true;
  if (entry.lane_count_source === 'lane_count_unknown') return true;
  return !(Number(entry.lane_count_total) > 0);
}

export function buildGeometryWayRow({
  routeKey,
  osmWayId,
  roadFeature,
  roadIndexEntry,
  matchedPoses,
  previewFeatures,
  evalLabelOsmLanes = null,
}) {
  const osmKey = normalizeOsmWayId(osmWayId);
  const base = {
    osm_way_id: osmKey,
    route_key: routeKey,
    road_name: roadFeature?.properties?.name ?? null,
    osm_lane_count_baseline: roadIndexEntry?.lane_count_total ?? null,
    selected_lane_count: null,
    confidence: 0,
    accepted_frame_count: 0,
    rejected_frame_reasons: [],
    boundary_clusters: { lane_boundaries: [], road_edges: [] },
    cross_section_ids: [],
    cross_section_exclusions: [],
    decision: OUTCOME.INSUFFICIENT_EVIDENCE,
    human_review_required: HUMAN_REVIEW_REQUIRED,
    never_auto_apply: NEVER_AUTO_APPLY,
    frame_evidence: [],
  };

  if (!isOneWayWay(roadFeature, roadIndexEntry)) {
    return {
      ...base,
      decision: OUTCOME.NOT_ELIGIBLE_TWO_WAY,
      cross_section_exclusions: [EXCLUSION.NOT_ONE_WAY],
    };
  }
  const coords = roadFeature?.geometry?.coordinates;
  if (!coords?.length) {
    return { ...base, decision: OUTCOME.NOT_ELIGIBLE_GEOMETRY };
  }

  const posesOnWay = (matchedPoses || []).filter(
    (f) => normalizeOsmWayId(f.properties?.osm_id) === osmKey
  );
  const { sections, exclusions } = selectCrossSections(osmKey, coords, posesOnWay);
  base.cross_section_exclusions = exclusions;
  if (!sections.length) {
    return {
      ...base,
      decision: OUTCOME.INSUFFICIENT_EVIDENCE,
      rejected_frame_reasons: exclusions.map((e) => ({ reason: e })),
    };
  }

  const best = sections.sort((a, b) => b.matched_pose_count - a.matched_pose_count)[0];
  base.cross_section_ids = [best.cross_section_id];

  const frames = collectFrameEvidence({
    routeKey,
    osmWayId: osmKey,
    crossSection: best,
    posesOnWay,
    previewFeatures,
  });
  base.frame_evidence = frames;
  const accepted = frames.filter((f) => f.accepted);
  const rejected = frames.filter((f) => !f.accepted);
  base.accepted_frame_count = accepted.length;
  base.rejected_frame_reasons = rejected.map((r) => ({
    frame_id: r.frame_id,
    reasons: r.rejection_reasons,
  }));

  if (accepted.length < 3) {
    return {
      ...base,
      decision: OUTCOME.INSUFFICIENT_EVIDENCE,
      note: 'Too few accepted cross-section frames.',
    };
  }

  const clusters = clusterBoundaries(accepted);
  base.boundary_clusters = clusters;

  const missing = missingOsmLanes(roadIndexEntry);
  const label = evalLabelOsmLanes ?? (missing ? null : roadIndexEntry?.lane_count_total);
  const hyp = deriveLaneHypothesis({
    clusters,
    acceptedFrames: accepted,
    osmLaneCountForEvalOnly: missing ? null : label,
    missingOsmLanes: missing,
  });

  return {
    ...base,
    selected_lane_count: hyp.selected_lane_count,
    confidence: hyp.confidence ?? 0,
    decision: hyp.outcome ?? OUTCOME.INSUFFICIENT_EVIDENCE,
    hypothesis_detail: hyp,
  };
}

import { OUTCOME } from './outcomes.js';
import { validateLaneEnrichmentInputContract } from './validate-contract.js';

function centrelinePoints(osmRoad) {
  const pts = osmRoad.centreline_local_m || osmRoad.centreline;
  return pts.map((p) => (Array.isArray(p) ? [p[0], p[1]] : [p.forward_m, p.lateral_m]));
}

function crossSectionForCore(cs, centreline) {
  if (cs.anchor && cs.tangent) {
    return {
      cross_section_id: cs.cross_section_id || 'from_contract',
      anchor: cs.anchor,
      tangent: cs.tangent,
    };
  }
  const anchor = [cs.anchor_forward_m, cs.anchor_lateral_m ?? 0];
  const tangent = cs.tangent_forward || [1, 0];
  return {
    cross_section_id: cs.cross_section_id || 'from_contract',
    anchor,
    tangent,
  };
}

function poseQuality(vf) {
  if (vf.pose_match?.quality != null) return vf.pose_match.quality;
  const hd = Math.abs(vf.pose_match?.heading_diff_deg ?? 0);
  const dm = vf.pose_match?.distance_m ?? 0;
  const q = 1 - Math.min(1, hd / 30) * 0.5 - Math.min(1, dm / 10) * 0.5;
  return Math.max(0, Math.min(1, q));
}

/**
 * Map validated contract → `runLaneEnrichmentCore` bundle. Does not run inference.
 */
export function toAlgorithmCoreBundle(raw) {
  const v = validateLaneEnrichmentInputContract(raw);
  if (!v.ok || v.outcome !== OUTCOME.VALID) {
    return { ok: false, validation: v };
  }
  const b = v.contract;
  const byFrame = new Map();
  for (const vf of b.vehicle_frames) {
    byFrame.set(vf.frame_id, {
      frame_id: vf.frame_id,
      pose_quality: poseQuality(vf),
      heading_aligned: (vf.pose_match?.heading_diff_deg ?? 0) <= 25,
      lines: [],
    });
  }
  for (const line of b.line_features) {
    const fr = byFrame.get(line.frame_id);
    if (!fr) continue;
    fr.lines.push({
      line_id: line.line_id,
      feature_type: line.feature_type,
      probability: line.probability ?? 1,
      coordinates_local_m: line.coordinates_local_m.map((c) => [c[0], c[1]]),
    });
  }
  const centreline = centrelinePoints(b.osm_road);
  return {
    ok: true,
    validation: v,
    bundle: {
      source_kind: 'polyline_contract',
      route_key: b.route_key,
      osm_way_id: b.osm_road.osm_way_id,
      centreline_section: {
        one_way: true,
        points: centreline,
        junction_nearby: b.osm_road.junction_nearby === true,
        merge_nearby: b.osm_road.merge_nearby === true,
      },
      cross_section: crossSectionForCore(b.cross_section, centreline),
      frames: [...byFrame.values()],
    },
  };
}

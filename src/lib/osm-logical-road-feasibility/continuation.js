import { headingDeltaDeg } from './geo-utils.js';
import { exitEndpointForTransition, wayEndpoint } from './way-store.js';

const LINK_HIGHWAYS = new Set([
  'motorway_link',
  'trunk_link',
  'primary_link',
  'secondary_link',
  'tertiary_link',
  'living_street',
  'service',
]);

const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);

function truthy(v) {
  return v === 'yes' || v === true || v === '1';
}

function layerOf(meta) {
  if (meta.layer == null || meta.layer === '') return 0;
  const n = Number(meta.layer);
  return Number.isFinite(n) ? n : 0;
}

function nameRefCompatible(a, b) {
  const names = [a.name, b.name].filter(Boolean);
  const refs = [a.ref, b.ref].filter(Boolean);
  if (names.length === 2 && names[0] !== names[1]) return false;
  if (refs.length === 2 && refs[0] !== refs[1]) return false;
  return true;
}

function highwayCompatible(a, b) {
  const ha = a.highway;
  const hb = b.highway;
  if (!ha || !hb) return { ok: true, weak: true };
  if (ha === hb) return { ok: true, weak: false };
  if (LINK_HIGHWAYS.has(ha) || LINK_HIGHWAYS.has(hb)) return { ok: true, weak: true, link: true };
  if (MAJOR.has(ha) && MAJOR.has(hb)) return { ok: false, weak: false };
  return { ok: true, weak: true };
}

function laneConflict(a, b) {
  const la = a.lanes != null ? Number(a.lanes) : null;
  const lb = b.lanes != null ? Number(b.lanes) : null;
  if (la == null || lb == null) return false;
  return la !== lb;
}

function isRoundabout(meta) {
  return meta.junction === 'roundabout' || meta.highway === 'mini_roundabout';
}

function gradeSeparationMismatch(a, b) {
  const la = layerOf(a);
  const lb = layerOf(b);
  if (la !== lb) return true;
  if (truthy(a.bridge) !== truthy(b.bridge)) return true;
  if (truthy(a.tunnel) !== truthy(b.tunnel)) return true;
  return false;
}

function directionCompatible(fromWay, toWay, exitPair, maxHeadingDeg) {
  const fromEp = wayEndpoint(fromWay, exitPair.from_end);
  const toEp = wayEndpoint(toWay, exitPair.to_end);
  const headingChange = headingDeltaDeg(fromEp.outward_bearing_deg, toEp.inward_bearing_deg);
  const rev = headingDeltaDeg(fromEp.outward_bearing_deg, (toEp.inward_bearing_deg + 180) % 360);
  let onewayBlock = false;
  if (truthy(fromWay.oneway) && exitPair.from_end === 'start') onewayBlock = true;
  if (truthy(toWay.oneway) && exitPair.to_end === 'end') onewayBlock = true;
  const forwardOk = headingChange <= maxHeadingDeg && !onewayBlock;
  return { headingChange, forwardOk, onewayBlock, reverseHeading: rev };
}

export function listCandidateContinuations(fromOsmId, wayStore, { toleranceM, maxHeadingDeg }) {
  const fromWay = wayStore.ways.get(String(fromOsmId));
  if (!fromWay) return [];
  const candidates = [];
  for (const [toId, toWay] of wayStore.ways) {
    if (toId === String(fromOsmId)) continue;
    const exit = exitEndpointForTransition(fromWay, toWay);
    if (exit.distance_m > toleranceM) continue;
    const dir = directionCompatible(fromWay, toWay, exit, maxHeadingDeg);
    if (!dir.forwardOk) continue;
    candidates.push({
      to_osm_id: toId,
      endpoint_distance_m: exit.distance_m,
      from_end: exit.from_end,
      to_end: exit.to_end,
      heading_change_deg: dir.headingChange,
      exact_shared_node: exit.distance_m === 0 && exit.from_coord.coord_key === exit.to_coord.coord_key,
      to_meta: toWay,
    });
  }
  return candidates;
}

/**
 * @returns {{ classification: string, confidence: number, reasons: string[], candidates: object[], transition_kind?: string }}
 */
export function classifyOsmWayTransition(fromOsmId, toOsmId, wayStore, params) {
  const toleranceM = params.toleranceM;
  const maxHeadingDeg = params.maxHeadingDeg;
  const fromWay = wayStore.ways.get(String(fromOsmId));
  const toWay = wayStore.ways.get(String(toOsmId));
  const reasons = [];
  if (!fromWay || !toWay) {
    return { classification: 'insufficient_metadata', confidence: 0, reasons: ['missing_way'], candidates: [] };
  }
  const exit = exitEndpointForTransition(fromWay, toWay);
  if (exit.distance_m > toleranceM) {
    return {
      classification: exit.distance_m > toleranceM * 4 ? 'disconnected' : 'endpoint_gap_too_large',
      confidence: 0.9,
      reasons: [`gap_${exit.distance_m.toFixed(3)}m`],
      candidates: [],
      endpoint_distance_m: exit.distance_m,
    };
  }

  if (isRoundabout(fromWay) || isRoundabout(toWay)) {
    return {
      classification: 'roundabout_transition',
      confidence: 0.95,
      reasons: ['roundabout_tag'],
      candidates: [],
      endpoint_distance_m: exit.distance_m,
    };
  }

  if (gradeSeparationMismatch(fromWay, toWay)) {
    return {
      classification: 'grade_separation_mismatch',
      confidence: 0.9,
      reasons: ['layer_bridge_tunnel'],
      candidates: [],
      endpoint_distance_m: exit.distance_m,
    };
  }

  const hw = highwayCompatible(fromWay, toWay);
  if (!hw.ok) {
    return {
      classification: 'road_class_mismatch',
      confidence: 0.85,
      reasons: ['highway_class'],
      candidates: [],
      endpoint_distance_m: exit.distance_m,
    };
  }

  if (laneConflict(fromWay, toWay)) {
    return {
      classification: 'lane_semantics_mismatch',
      confidence: 0.8,
      reasons: ['lanes_differ'],
      candidates: [],
      endpoint_distance_m: exit.distance_m,
    };
  }

  if (!nameRefCompatible(fromWay, toWay)) {
    return {
      classification: 'ambiguous_junction',
      confidence: 0.75,
      reasons: ['name_or_ref_fork'],
      candidates: [],
      endpoint_distance_m: exit.distance_m,
    };
  }

  const dir = directionCompatible(fromWay, toWay, exit, maxHeadingDeg);
  if (dir.onewayBlock) {
    return {
      classification: 'directionality_mismatch',
      confidence: 0.9,
      reasons: ['oneway'],
      candidates: [],
      endpoint_distance_m: exit.distance_m,
      heading_change_deg: dir.headingChange,
    };
  }
  if (!dir.forwardOk) {
    return {
      classification: 'directionality_mismatch',
      confidence: 0.85,
      reasons: ['heading'],
      candidates: [],
      endpoint_distance_m: exit.distance_m,
      heading_change_deg: dir.headingChange,
    };
  }

  const allCandidates = listCandidateContinuations(fromOsmId, wayStore, params);
  const compatible = allCandidates.filter((c) => {
    const hw2 = highwayCompatible(fromWay, c.to_meta);
    if (!hw2.ok) return false;
    if (gradeSeparationMismatch(fromWay, c.to_meta)) return false;
    if (laneConflict(fromWay, c.to_meta)) return false;
    if (!nameRefCompatible(fromWay, c.to_meta)) return false;
    if (isRoundabout(c.to_meta)) return false;
    return true;
  });

  const linkTransition =
    LINK_HIGHWAYS.has(fromWay.highway) ||
    LINK_HIGHWAYS.has(toWay.highway) ||
    fromWay.highway === 'construction' ||
    toWay.highway === 'construction';
  if (linkTransition && compatible.length !== 1) {
    return {
      classification: 'ramp_or_link_transition',
      confidence: 0.7,
      reasons: ['link_highway'],
      candidates: compatible.map((c) => c.to_osm_id),
      endpoint_distance_m: exit.distance_m,
      heading_change_deg: dir.headingChange,
    };
  }

  if (compatible.length === 0) {
    return {
      classification: 'disconnected',
      confidence: 0.6,
      reasons: ['no_compatible_continuation'],
      candidates: [],
      endpoint_distance_m: exit.distance_m,
    };
  }

  if (compatible.length > 1) {
    const sameName = new Set(compatible.map((c) => c.to_meta.name || c.to_meta.ref || c.to_osm_id));
    if (sameName.size < compatible.length) {
      return {
        classification: 'parallel_carriageway_risk',
        confidence: 0.8,
        reasons: ['multiple_compatible_branches'],
        candidates: compatible.map((c) => c.to_osm_id),
        endpoint_distance_m: exit.distance_m,
        heading_change_deg: dir.headingChange,
      };
    }
    return {
      classification: 'ambiguous_junction',
      confidence: 0.75,
      reasons: ['multiple_candidates'],
      candidates: compatible.map((c) => c.to_osm_id),
      endpoint_distance_m: exit.distance_m,
      heading_change_deg: dir.headingChange,
    };
  }

  const exitNodeKey = exit.from_coord.coord_key;
  const nodeDegree = wayStore.degreeByKey?.get(exitNodeKey) || 0;
  if (nodeDegree > 2) {
    return {
      classification: 'ambiguous_junction',
      confidence: 0.85,
      reasons: ['multi_arm_node'],
      candidates: compatible.map((c) => c.to_osm_id),
      endpoint_distance_m: exit.distance_m,
      heading_change_deg: dir.headingChange,
    };
  }

  const only = compatible[0];
  if (only.to_osm_id !== String(toOsmId)) {
    return {
      classification: 'ambiguous_junction',
      confidence: 0.7,
      reasons: ['observed_pair_not_unique_continuation'],
      candidates: compatible.map((c) => c.to_osm_id),
      endpoint_distance_m: exit.distance_m,
    };
  }

  let confidence = 0.85;
  if (hw.weak) confidence -= 0.1;
  if (!fromWay.name && !fromWay.ref) confidence -= 0.05;
  if (!only.exact_shared_node && exit.distance_m > 0) confidence -= 0.05;

  return {
    classification: 'safe_unique_continuation',
    confidence: Math.max(0.5, confidence),
    reasons: [],
    candidates: [only.to_osm_id],
    endpoint_distance_m: exit.distance_m,
    heading_change_deg: dir.headingChange,
    exact_shared_node: only.exact_shared_node,
    transition_kind: only.exact_shared_node ? 'exact_shared_endpoint' : 'near_endpoint',
  };
}

export const CONTINUATION_CLASSES = [
  'safe_unique_continuation',
  'ambiguous_junction',
  'parallel_carriageway_risk',
  'grade_separation_mismatch',
  'directionality_mismatch',
  'lane_semantics_mismatch',
  'road_class_mismatch',
  'ramp_or_link_transition',
  'roundabout_transition',
  'endpoint_gap_too_large',
  'insufficient_metadata',
  'disconnected',
];

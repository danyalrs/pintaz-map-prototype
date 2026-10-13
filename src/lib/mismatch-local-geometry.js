import {
  dedupeCoordinates,
  lineStringToRoadSurface,
  validateRoadSurface,
  lineLengthM,
  laneDividerOffsets,
  MIN_SOURCE_SEGMENT_M,
} from './lane-geometry.js';
import { interpretOsmRoadProperties } from './lane-interpret.js';
import { projectAlongCentreline } from './mismatch-projection.js';
import { haversineMetres } from './geo-square.js';

/** Along-road margin (m) added to observed pose span when clipping centreline. */
export const LOCAL_ALONG_MARGIN_M = 4;

export function observedAlongSpanM(poses, centreCoords) {
  let minS = Infinity;
  let maxS = -Infinity;
  for (const pose of poses) {
    const [lon, lat] = pose.geometry.coordinates;
    const proj = projectAlongCentreline(lon, lat, centreCoords);
    if (!proj) continue;
    minS = Math.min(minS, proj.chainS);
    maxS = Math.max(maxS, proj.chainS);
  }
  if (!Number.isFinite(minS)) return null;
  return {
    minS: Math.max(0, minS - LOCAL_ALONG_MARGIN_M),
    maxS: maxS + LOCAL_ALONG_MARGIN_M,
    spanM: maxS - minS,
  };
}

/** Clip centreline to chain-s window by walking cumulative segment length. */
export function clipCentrelineToAlongRange(coords, minS, maxS) {
  const clean = dedupeCoordinates(coords);
  if (clean.length < 2) return clean;
  const cum = [0];
  for (let i = 1; i < clean.length; i++) {
    cum.push(
      cum[i - 1] +
        haversineMetres(clean[i - 1][0], clean[i - 1][1], clean[i][0], clean[i][1])
    );
  }
  const out = [];
  for (let i = 0; i < clean.length; i++) {
    const s = cum[i];
    if (s >= minS - 0.01 && s <= maxS + 0.01) out.push(clean[i]);
  }
  if (out.length < 2) {
    let bestI = 0;
    let bestD = Infinity;
    const mid = (minS + maxS) / 2;
    for (let i = 0; i < cum.length; i++) {
      const d = Math.abs(cum[i] - mid);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    const a = Math.max(0, bestI - 1);
    const b = Math.min(clean.length - 1, bestI + 1);
    return clean.slice(a, b + 1);
  }
  return dedupeCoordinates(out);
}

/**
 * Run the same surface build/validate gates as lane baseline on a local centreline window only.
 */
export function validateLocalSectionSurface(roadProperties, localCoords, categoryWidthM = 6) {
  const coords = dedupeCoordinates(localCoords);
  const len = lineLengthM(coords);
  if (len < MIN_SOURCE_SEGMENT_M || coords.length < 2) {
    return {
      ok: false,
      reason: 'source_too_short',
      global_surface_accepted: false,
      local_surface_accepted: false,
      local_surface_rejection_reason: 'source_too_short',
    };
  }
  const interp = interpretOsmRoadProperties(roadProperties, categoryWidthM);
  const halfW = interp.road_width_m / 2;
  const poly = lineStringToRoadSurface(coords, halfW);
  if (!poly) {
    return {
      ok: false,
      reason: 'surface_build_failed',
      interp,
      local_surface_rejection_reason: 'surface_build_failed',
    };
  }
  const validation = validateRoadSurface(poly, coords, halfW, len);
  const dividerOffsets =
    interp.lane_count_total && interp.lane_count_total >= 2
      ? laneDividerOffsets(interp.lane_count_total, interp.road_width_m, interp.direction_confidence)
      : [];
  return {
    ok: validation.ok,
    reason: validation.reason,
    interp,
    halfW,
    dividerOffsets,
    local_surface_accepted: validation.ok,
    local_surface_rejection_reason: validation.ok ? null : validation.reason,
    analysis: validation.analysis,
  };
}

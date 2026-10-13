import { LIMITS } from './constants.js';
import { centrelineTurnDeg } from './math.js';

export function selectCrossSection(bundle) {
  const points = bundle.centreline_section?.points || [];
  const exclusions = [];
  if (bundle.centreline_section?.junction_nearby) {
    exclusions.push('junction_nearby');
  }
  if (bundle.centreline_section?.merge_nearby) {
    exclusions.push('merge_nearby');
  }
  if (points.length < 2) {
    exclusions.push('centreline_too_short');
    return { ok: false, cross_section: null, exclusions };
  }
  let maxTurn = 0;
  for (let i = 0; i < points.length - 2; i++) {
    maxTurn = Math.max(maxTurn, centrelineTurnDeg(points[i], points[i + 1], points[i + 2]));
  }
  if (maxTurn > LIMITS.maxCentrelineTurnDeg) {
    exclusions.push('sharp_curve');
  }
  const cs = bundle.cross_section;
  if (!cs?.anchor || !cs?.tangent) {
    exclusions.push('invalid_cross_section');
    return { ok: false, cross_section: null, exclusions };
  }
  if (exclusions.length) {
    return { ok: false, cross_section: cs, exclusions };
  }
  return {
    ok: true,
    cross_section: {
      cross_section_id: cs.cross_section_id || 'validated',
      anchor: cs.anchor,
      tangent: cs.tangent,
    },
    exclusions,
  };
}

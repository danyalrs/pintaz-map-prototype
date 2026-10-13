const REQUIRED_FRAME_KEYS = ['schema', 'forward_axis', 'lateral_axis', 'units'];

export function validateCoordinateFrame(frame) {
  if (!frame || typeof frame !== 'object') {
    return { ok: false, reason: 'missing' };
  }
  for (const k of REQUIRED_FRAME_KEYS) {
    if (frame[k] == null || frame[k] === '') {
      return { ok: false, reason: `missing_${k}` };
    }
  }
  if (frame.units !== 'metres' && frame.units !== 'm') {
    return { ok: false, reason: 'units_not_metres' };
  }
  return { ok: true };
}

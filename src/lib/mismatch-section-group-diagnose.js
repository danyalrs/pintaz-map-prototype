import { haversineMetres } from './geo-square.js';

const MAX_SPATIAL_GAP_M = 45;
const MAX_TIME_GAP_NS = 4e9;

export function diagnoseSectionBreaks(matches, { maxSpatialGapM = MAX_SPATIAL_GAP_M, maxTimeGapNs = MAX_TIME_GAP_NS } = {}) {
  const sorted = [...matches].sort((a, b) => a.properties.pose_index - b.properties.pose_index);
  const breaks = [];
  let cur = [];

  const recordBreak = (reason, prev, p) => {
    breaks.push({
      reason,
      from_pose_index: prev?.properties?.pose_index,
      to_pose_index: p?.properties?.pose_index,
      from_osm_id: prev?.properties?.osm_id,
      to_osm_id: p?.properties?.osm_id,
      from_frame_id: prev?.properties?.frame_id,
      to_frame_id: p?.properties?.frame_id,
    });
  };

  for (const m of sorted) {
    const p = m.properties;
    const prev = cur[cur.length - 1];
    if (!prev) {
      cur.push(m);
      continue;
    }
    const prevP = prev.properties;
    const prevGeom = prev.geometry.coordinates;
    const geom = m.geometry.coordinates;
    let reason = null;
    if (String(prevP.osm_id) !== String(p.osm_id)) reason = 'osm_way_change';
    else if (prevP.bridge !== p.bridge || prevP.tunnel !== p.tunnel) reason = 'structure_boundary';
    else {
      const d = haversineMetres(prevGeom[0], prevGeom[1], geom[0], geom[1]);
      if (d > maxSpatialGapM) reason = 'spatial_gap';
      else {
        const t0 = Number(prevP.log_mono_time);
        const t1 = Number(p.log_mono_time);
        if (Number.isFinite(t0) && Number.isFinite(t1) && Math.abs(t1 - t0) > maxTimeGapNs) {
          reason = 'timestamp_gap';
        }
      }
    }
    if (reason) {
      if (cur.length) breaks.push({ section_end_reason: reason, section_pose_count: cur.length });
      recordBreak(reason, prevP, p);
      cur = [m];
    } else {
      cur.push(m);
    }
  }
  if (cur.length) breaks.push({ section_end_reason: 'end_of_sequence', section_pose_count: cur.length });
  return { break_events: breaks, section_count: breaks.filter((b) => b.section_pose_count).length };
}

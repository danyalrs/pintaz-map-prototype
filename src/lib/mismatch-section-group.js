import { haversineMetres } from './geo-square.js';

const MAX_SPATIAL_GAP_M = 45;
const MAX_TIME_GAP_NS = 4e9;

/**
 * Legacy V1 grouping (frame_id gap > 8 breaks) — used for before/after reporting.
 */
export function groupSectionsLegacyFrameGap(matches) {
  const sorted = [...matches].sort((a, b) => a.properties.pose_index - b.properties.pose_index);
  const sections = [];
  let cur = [];
  for (const m of sorted) {
    const p = m.properties;
    const prev = cur[cur.length - 1]?.properties;
    const breakSection =
      !prev ||
      prev.osm_id !== p.osm_id ||
      Math.abs(Number(p.frame_id) - Number(prev.frame_id)) > 8 ||
      prev.bridge !== p.bridge ||
      prev.tunnel !== p.tunnel;
    if (breakSection && cur.length) {
      sections.push(cur);
      cur = [];
    }
    cur.push(m);
  }
  if (cur.length) sections.push(cur);
  return sections;
}

/**
 * V1.1: contiguous chains on same OSM way using spatial + time continuity (not frame_id alone).
 */
export function groupSectionsContiguous(
  matches,
  { maxSpatialGapM = MAX_SPATIAL_GAP_M, maxTimeGapNs = MAX_TIME_GAP_NS, osmGroupingKey = null } = {}
) {
  const sorted = [...matches].sort((a, b) => a.properties.pose_index - b.properties.pose_index);
  const sections = [];
  let cur = [];
  const groupKey = osmGroupingKey || ((props) => String(props.osm_id));

  const shouldBreak = (prev, p, prevGeom, geom) => {
    if (!prev) return false;
    if (groupKey(prev) !== groupKey(p)) return true;
    if (prev.bridge !== p.bridge || prev.tunnel !== p.tunnel) return true;
    const d = haversineMetres(prevGeom[0], prevGeom[1], geom[0], geom[1]);
    if (d > maxSpatialGapM) return true;
    const t0 = Number(prev.log_mono_time);
    const t1 = Number(p.log_mono_time);
    if (Number.isFinite(t0) && Number.isFinite(t1) && Math.abs(t1 - t0) > maxTimeGapNs) return true;
    return false;
  };

  for (const m of sorted) {
    const p = m.properties;
    const prev = cur[cur.length - 1];
    const breakSection = shouldBreak(
      prev?.properties,
      p,
      prev?.geometry.coordinates,
      m.geometry.coordinates
    );
    if (breakSection && cur.length) {
      sections.push(cur);
      cur = [];
    }
    cur.push(m);
  }
  if (cur.length) sections.push(cur);
  return sections;
}

import { headingDifferenceDeg, movementBearingDeg, pointToSegmentMetres } from './geo-segment.js';
import { querySegmentsNear } from './osm-segment-index.js';

const AMBIGUOUS_SCORE_RATIO = 0.12;
const JUNCTION_DIST_M = 18;

function isOneway(seg) {
  const o = String(seg.oneway ?? '').toLowerCase();
  return o === 'yes' || o === '1' || o === 'true' || o === '-1';
}

export function onewayCompatible(seg, moveBearing) {
  if (!isOneway(seg) || moveBearing == null) return true;
  const rev = seg.oneway === '-1';
  const segBear = rev ? (seg.headingDeg + 180) % 360 : seg.headingDeg;
  const diff = headingDifferenceDeg(moveBearing, segBear);
  return diff <= 55;
}

function scoreCandidate(seg, distM, headDiff, prevOsmId) {
  const distScore = Math.max(0, 1 - distM / 25);
  const headScore = Math.max(0, 1 - headDiff / 90);
  const continuity = prevOsmId && String(seg.osm_id) === String(prevOsmId) ? 0.25 : 0;
  const bridgePenalty = seg.bridge || seg.tunnel ? 0.05 : 0;
  return distScore * 0.55 + headScore * 0.35 + continuity - bridgePenalty;
}

function nearJunctionStructure(seg, allCandidates) {
  const others = new Set(allCandidates.map((c) => c.seg.osm_id));
  if (others.size >= 3) return true;
  if (seg.bridge || seg.tunnel) return true;
  return false;
}

/**
 * @returns {{ match, rejected, stats }}
 */
export function matchVehiclePoses(poses, osmIndex, { searchRadiusM = 15 } = {}) {
  const matches = [];
  const rejected = [];
  let prevLon = null;
  let prevLat = null;
  let prevOsmId = null;

  for (let i = 0; i < poses.length; i += 1) {
    const pose = poses[i];
    const [lon, lat] = pose.geometry.coordinates;
    const moveBearing = movementBearingDeg(prevLon, prevLat, lon, lat);
    prevLon = lon;
    prevLat = lat;

    const nearbySegs = querySegmentsNear(osmIndex, lon, lat, searchRadiusM);
    const candidates = [];
    for (const seg of nearbySegs) {
      const [aLon, aLat] = seg.start;
      const [bLon, bLat] = seg.end;
      const { distanceM, alongM } = pointToSegmentMetres(lon, lat, aLon, aLat, bLon, bLat);
      if (distanceM > searchRadiusM) continue;
      const poseHeading = Number(pose.properties?.heading_deg);
      const headDiff = moveBearing != null
        ? headingDifferenceDeg(moveBearing, seg.headingDeg)
        : headingDifferenceDeg(Number.isFinite(poseHeading) ? poseHeading : seg.headingDeg, seg.headingDeg);
      if (!onewayCompatible(seg, moveBearing)) continue;
      const score = scoreCandidate(seg, distanceM, headDiff, prevOsmId);
      candidates.push({ seg, distanceM, alongM, headDiff, score });
    }

    candidates.sort((a, b) => b.score - a.score);
    const baseProps = {
      pose_index: i,
      frame_id: pose.properties?.frame_id,
      log_mono_time: pose.properties?.log_mono_time,
    };

    if (!candidates.length) {
      rejected.push({
        type: 'Feature',
        geometry: pose.geometry,
        properties: {
          ...baseProps,
          reason: 'no_candidate_within_radius',
          search_radius_m: searchRadiusM,
        },
      });
      continue;
    }

    const best = candidates[0];
    const second = candidates[1];
    if (
      second &&
      (best.score - second.score < AMBIGUOUS_SCORE_RATIO ||
        Math.abs(best.distanceM - second.distanceM) < 2)
    ) {
      const parallel = best.seg.osm_id !== second.seg.osm_id;
      rejected.push({
        type: 'Feature',
        geometry: pose.geometry,
        properties: {
          ...baseProps,
          reason: parallel ? 'ambiguous_parallel_road' : 'ambiguous_candidate_tie',
          best_osm_id: best.seg.osm_id,
          second_osm_id: second.seg.osm_id,
          best_distance_m: best.distanceM,
          second_distance_m: second.distanceM,
        },
      });
      continue;
    }

    if (nearJunctionStructure(best.seg, candidates.slice(0, 4)) && candidates.length >= 4) {
      const close = candidates.filter((c) => c.distanceM <= JUNCTION_DIST_M);
      if (close.length >= 3 && new Set(close.map((c) => c.seg.osm_id)).size >= 2) {
        rejected.push({
          type: 'Feature',
          geometry: pose.geometry,
          properties: {
            ...baseProps,
            reason: 'ambiguous_junction_or_flyover',
            candidate_count: close.length,
          },
        });
        continue;
      }
    }

    prevOsmId = best.seg.osm_id;
    matches.push({
      type: 'Feature',
      geometry: pose.geometry,
      properties: {
        ...baseProps,
        osm_id: best.seg.osm_id,
        highway: best.seg.highway,
        name: best.seg.name,
        distance_m: best.distanceM,
        heading_diff_deg: best.headDiff,
        along_segment_m: best.alongM,
        segment_heading_deg: best.seg.headingDeg,
        bridge: best.seg.bridge ?? null,
        tunnel: best.seg.tunnel ?? null,
        search_radius_m: searchRadiusM,
      },
    });
  }

  return { matches, rejected };
}

export function sortPoses(features) {
  return [...features].sort((a, b) => {
    const ta = Number(a.properties?.log_mono_time ?? a.properties?.frame_index ?? 0);
    const tb = Number(b.properties?.log_mono_time ?? b.properties?.frame_index ?? 0);
    return ta - tb;
  });
}

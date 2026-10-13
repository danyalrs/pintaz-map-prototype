import { diagnoseSectionBreaks } from '../mismatch-section-group-diagnose.js';
import { groupSectionsContiguous } from '../mismatch-section-group.js';
import { DEFAULT_PARAMS } from '../mismatch-classify.js';
import { classifyOsmWayTransition } from './continuation.js';
import { haversineMetres } from '../geo-square.js';

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function sectionStats(sections) {
  const frames = sections.map((s) => s.length).sort((a, b) => a - b);
  const lengths = sections
    .map((sec) => {
      let sum = 0;
      for (let i = 1; i < sec.length; i++) {
        sum += haversineMetres(
          sec[i - 1].geometry.coordinates[0],
          sec[i - 1].geometry.coordinates[1],
          sec[i].geometry.coordinates[0],
          sec[i].geometry.coordinates[1]
        );
      }
      return sum;
    })
    .sort((a, b) => a - b);
  return {
    section_count: sections.length,
    median_frames: percentile(frames, 50),
    p90_frames: percentile(frames, 90),
    median_length_m: percentile(lengths, 50),
    p90_length_m: percentile(lengths, 90),
  };
}

function countBreakReasons(breakEvents) {
  const counts = {};
  for (const b of breakEvents) {
    if (!b.reason) continue;
    counts[b.reason] = (counts[b.reason] || 0) + 1;
  }
  return counts;
}

function gateCombineSides(leftFrames, rightFrames, leftLen, rightLen) {
  const combinedFrames = leftFrames + rightFrames;
  const combinedLen = leftLen + rightLen;
  return {
    combined_frames: combinedFrames,
    combined_length_m: combinedLen,
    passes_min_frames: combinedFrames >= DEFAULT_PARAMS.minFrames,
    passes_min_length: combinedLen >= DEFAULT_PARAMS.minSectionLengthM,
  };
}

export function auditDriveFragmentation(driveRef, poses, wayStore, classifyParams) {
  const features = poses.features || poses;
  const chains = groupSectionsContiguous(features);
  const { break_events: breaks } = diagnoseSectionBreaks(features);
  const reasonCounts = countBreakReasons(breaks);

  const osmChanges = breaks.filter((b) => b.reason === 'osm_way_change');
  const enriched = [];
  const categoryCounts = {
    exact_shared_endpoint: 0,
    near_endpoint: 0,
    disconnected: 0,
    junction_transitions: 0,
    parallel_road: 0,
    grade_separated: 0,
    ramp_link: 0,
    roundabout: 0,
  };

  const sorted = [...features].sort((a, b) => a.properties.pose_index - b.properties.pose_index);
  const sectionsByBreak = [];
  let curSec = [];
  for (let i = 0; i < sorted.length; i++) {
    curSec.push(sorted[i]);
    const next = sorted[i + 1];
    if (!next || String(sorted[i].properties.osm_id) !== String(next.properties.osm_id)) {
      sectionsByBreak.push(curSec);
      curSec = [];
    }
  }

  let secIdx = 0;
  for (const ev of osmChanges) {
    const left = sectionsByBreak[secIdx] || [];
    const right = sectionsByBreak[secIdx + 1] || [];
    secIdx += 1;
    const fromOsm = String(left[left.length - 1]?.properties?.osm_id ?? ev.from_osm_id);
    const toOsm = String(right[0]?.properties?.osm_id ?? ev.to_osm_id);
    const verdict = classifyOsmWayTransition(fromOsm, toOsm, wayStore, classifyParams);
    let leftLen = 0;
    for (let i = 1; i < left.length; i++) {
      leftLen += haversineMetres(
        left[i - 1].geometry.coordinates[0],
        left[i - 1].geometry.coordinates[1],
        left[i].geometry.coordinates[0],
        left[i].geometry.coordinates[1]
      );
    }
    let rightLen = 0;
    for (let i = 1; i < right.length; i++) {
      rightLen += haversineMetres(
        right[i - 1].geometry.coordinates[0],
        right[i - 1].geometry.coordinates[1],
        right[i].geometry.coordinates[0],
        right[i].geometry.coordinates[1]
      );
    }
    const gates = gateCombineSides(left.length, right.length, leftLen, rightLen);

    const cls = verdict.classification;
    if (cls === 'roundabout_transition') categoryCounts.roundabout += 1;
    else if (cls === 'grade_separation_mismatch') categoryCounts.grade_separated += 1;
    else if (cls === 'ramp_or_link_transition') categoryCounts.ramp_link += 1;
    else if (cls === 'parallel_carriageway_risk') categoryCounts.parallel_road += 1;
    else if (cls === 'ambiguous_junction') categoryCounts.junction_transitions += 1;
    else if (cls === 'disconnected' || cls === 'endpoint_gap_too_large') categoryCounts.disconnected += 1;
    else if (verdict.exact_shared_node) categoryCounts.exact_shared_endpoint += 1;
    else if (verdict.transition_kind === 'near_endpoint' || (verdict.endpoint_distance_m ?? 0) <= classifyParams.toleranceM) {
      categoryCounts.near_endpoint += 1;
    }

    enriched.push({
      drive_ref: driveRef,
      from_osm_id: fromOsm,
      to_osm_id: toOsm,
      from_frame_id: ev.from_frame_id,
      to_frame_id: ev.to_frame_id,
      split_reason: 'osm_way_change',
      continuation_classification: verdict.classification,
      endpoint_distance_m: verdict.endpoint_distance_m,
      heading_change_deg: verdict.heading_change_deg,
      left_frames: left.length,
      right_frames: right.length,
      left_length_m: Math.round(leftLen * 10) / 10,
      right_length_m: Math.round(rightLen * 10) / 10,
      combine_gate_check: gates,
      metadata: {
        from_name: wayStore.ways.get(fromOsm)?.name ?? null,
        to_name: wayStore.ways.get(toOsm)?.name ?? null,
      },
    });
  }

  return {
    drive_ref: driveRef,
    matched_pose_count: features.length,
    matched_pose_chain_count: chains.length,
    section_count: chains.length,
    break_reason_counts: reasonCounts,
    osm_way_change_count: osmChanges.length,
    osm_way_change_categories: categoryCounts,
    section_distribution: sectionStats(chains),
    transitions: enriched,
  };
}

export function summarizeFragmentation(perDrive) {
  const overall = {
    drives: perDrive.length,
    matched_poses: 0,
    sections: 0,
    osm_way_change_splits: 0,
    break_reason_counts: {},
    osm_way_change_categories: {},
  };
  for (const d of perDrive) {
    overall.matched_poses += d.matched_pose_count;
    overall.sections += d.section_count;
    overall.osm_way_change_splits += d.osm_way_change_count;
    for (const [k, v] of Object.entries(d.break_reason_counts || {})) {
      overall.break_reason_counts[k] = (overall.break_reason_counts[k] || 0) + v;
    }
    for (const [k, v] of Object.entries(d.osm_way_change_categories || {})) {
      overall.osm_way_change_categories[k] = (overall.osm_way_change_categories[k] || 0) + v;
    }
  }
  return overall;
}

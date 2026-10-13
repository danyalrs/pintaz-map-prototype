import { createHash } from 'node:crypto';
import { DEFAULT_PARAMS } from './mismatch-classify.js';
import { LOCAL_ALONG_MARGIN_M } from './mismatch-local-geometry.js';
import { isActionableMismatch, CONSISTENT_CLASS } from './mismatch-ui-groups.js';

const POSSIBLE_CLASSES = [
  'possible_lane_count_mismatch',
  'possible_centerline_offset',
  'possible_display_width_difference',
  'osm_lane_metadata_missing',
];

export function spansOverlapOrAdjacent(a, b) {
  if (a.along_start_m == null || a.along_end_m == null || b.along_start_m == null || b.along_end_m == null) {
    return false;
  }
  const gap = Math.max(b.along_start_m - a.along_end_m, a.along_start_m - b.along_end_m);
  return gap <= LOCAL_ALONG_MARGIN_M + 0.5;
}

function supportEligibleForClass(section, classification) {
  if (classification === 'possible_centerline_offset') {
    return Boolean(section.support_eligible_centreline);
  }
  if (classification === 'possible_lane_count_mismatch') {
    return Boolean(section.support_eligible_lane_edge);
  }
  if (classification === 'possible_display_width_difference') {
    return Boolean(section.support_eligible_lane_edge) && (section.frames_with_both_edges || 0) >= DEFAULT_PARAMS.minBothEdgeFrames;
  }
  if (classification === 'osm_lane_metadata_missing') {
    return Boolean(section.support_eligible_lane_edge);
  }
  if (classification === CONSISTENT_CLASS) {
    return Boolean(section.support_eligible_centreline || section.support_eligible_lane_edge);
  }
  return false;
}

function offsetSign(v) {
  if (v == null || !Number.isFinite(Number(v)) || Math.abs(Number(v)) < 0.05) return 0;
  return Math.sign(Number(v));
}

function offsetsCompatible(a, b) {
  const sa = offsetSign(a.median_common_centre_shift_m);
  const sb = offsetSign(b.median_common_centre_shift_m);
  if (sa !== sb || sa === 0) return sa === sb;
  const da = Math.abs(Number(a.median_common_centre_shift_m));
  const db = Math.abs(Number(b.median_common_centre_shift_m));
  return Math.abs(da - db) <= DEFAULT_PARAMS.residualToleranceM;
}

function aggregateId(osmId, classification, spanKey) {
  return createHash('sha256').update(`${osmId}|${classification}|${spanKey}`).digest('hex').slice(0, 16);
}

/**
 * @param {Array<{ drive_key, redacted_drive_ref, dongle_group, enriched_sections: Array }>} perDriveResults
 */
export function aggregateCrossDriveEvidence(perDriveResults) {
  const flat = [];
  for (const drive of perDriveResults) {
    for (const { section, along_start_m, along_end_m } of drive.enriched_sections || []) {
      const props = section.properties || {};
      flat.push({
        drive_key: drive.drive_key,
        redacted_drive_ref: drive.redacted_drive_ref,
        dongle_group: drive.dongle_group,
        osm_id: String(props.osm_id),
        classification: props.classification,
        along_start_m,
        along_end_m,
        geometry: section.geometry,
        support_eligible_centreline: props.support_eligible_centreline,
        support_eligible_lane_edge: props.support_eligible_lane_edge,
        sensitivity_stable: props.sensitivity_stable,
        median_common_centre_shift_m: props.median_common_centre_shift_m,
        frames_with_both_edges: props.frames_with_both_edges,
        gate_failures: props.gate_failures || [],
        section_length_m: props.section_length_m,
        vehicle_frames: props.vehicle_frames,
        confidence: props.confidence,
        per_drive_candidate_id: props.candidate_id,
      });
    }
  }

  const buckets = new Map();
  for (const row of flat) {
    const key = `${row.osm_id}|${row.classification}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }

  const aggregateFeatures = [];
  const stateCounts = {
    consistent_across_drives: 0,
    possible_mismatch_supported_by_multiple_drives: 0,
    single_drive_signal_only: 0,
    conflicting_drive_evidence: 0,
    insufficient_combined_evidence: 0,
    not_evaluated: 0,
  };

  for (const [, rows] of buckets) {
    const classification = rows[0].classification;
    const osmId = rows[0].osm_id;
    const clusters = [];
    for (const row of rows) {
      let placed = false;
      for (const cluster of clusters) {
        if (cluster.some((r) => spansOverlapOrAdjacent(r, row))) {
          cluster.push(row);
          placed = true;
          break;
        }
      }
      if (!placed) clusters.push([row]);
    }

    for (const cluster of clusters) {
      const spanKey = cluster
        .map((r) => `${r.along_start_m}-${r.along_end_m}`)
        .sort()
        .join('|');
      const supportRows = cluster.filter((r) => supportEligibleForClass(r, classification));
      const dongleGroups = new Set(supportRows.map((r) => r.dongle_group).filter(Boolean));
      const drives = new Set(supportRows.map((r) => r.redacted_drive_ref));

      let aggregate_state = 'not_evaluated';
      let conflict = false;

      const hasConsistent = cluster.every((r) => r.classification === CONSISTENT_CLASS);
      const consistentSupport = cluster.filter(
        (r) => r.classification === CONSISTENT_CLASS && supportEligibleForClass(r, CONSISTENT_CLASS)
      );

      if (classification === 'not_evaluated' || cluster.every((r) => r.classification === 'not_evaluated')) {
        aggregate_state = 'not_evaluated';
      } else if (POSSIBLE_CLASSES.includes(classification)) {
        const stableSupport = supportRows.filter((r) => r.sensitivity_stable);
        if (stableSupport.length >= 2 && dongleGroups.size >= 2) {
          if (classification === 'possible_centerline_offset') {
            conflict = !stableSupport.every((r, _, arr) => offsetsCompatible(r, arr[0]));
          }
          if (!conflict) {
            aggregate_state = 'possible_mismatch_supported_by_multiple_drives';
          } else {
            aggregate_state = 'conflicting_drive_evidence';
          }
        } else if (supportRows.length === 1 && isActionableMismatch(classification)) {
          aggregate_state = 'single_drive_signal_only';
        } else if (supportRows.length >= 2 && dongleGroups.size < 2) {
          aggregate_state = 'insufficient_combined_evidence';
        } else if (supportRows.length >= 2 && stableSupport.length < 2) {
          aggregate_state = 'insufficient_combined_evidence';
        } else if (supportRows.length === 0) {
          aggregate_state = cluster.some((r) => r.geometry) ? 'insufficient_combined_evidence' : 'not_evaluated';
        } else if (conflict) {
          aggregate_state = 'conflicting_drive_evidence';
        } else {
          aggregate_state = 'insufficient_combined_evidence';
        }
      } else if (classification === CONSISTENT_CLASS && consistentSupport.length >= 2 && dongleGroups.size >= 2) {
        aggregate_state = 'consistent_across_drives';
      } else if (hasConsistent && consistentSupport.length >= 1) {
        aggregate_state = consistentSupport.length >= 2 ? 'consistent_across_drives' : 'insufficient_combined_evidence';
      } else {
        aggregate_state = cluster.some((r) => r.geometry) ? 'insufficient_combined_evidence' : 'not_evaluated';
      }

      stateCounts[aggregate_state] = (stateCounts[aggregate_state] || 0) + 1;
      const aggId = aggregateId(osmId, classification, spanKey);
      const geom = cluster.find((r) => r.geometry)?.geometry || null;
      aggregateFeatures.push({
        type: 'Feature',
        geometry: geom,
        properties: {
          aggregate_id: aggId,
          osm_id: osmId,
          mismatch_class: classification,
          aggregate_state,
          participating_drives: [...new Set(cluster.map((r) => r.redacted_drive_ref))].sort(),
          distinct_dongle_groups: [...dongleGroups].sort(),
          per_drive_evidence: cluster.map((r) => ({
            redacted_drive_ref: r.redacted_drive_ref,
            dongle_group: r.dongle_group,
            classification: r.classification,
            along_start_m: r.along_start_m,
            along_end_m: r.along_end_m,
            support_eligible_centreline: r.support_eligible_centreline,
            support_eligible_lane_edge: r.support_eligible_lane_edge,
            sensitivity_stable: r.sensitivity_stable,
            vehicle_frames: r.vehicle_frames,
            confidence: r.confidence,
          })),
          support_drive_count: supportRows.length,
          overlapping_span: {
            along_start_m: Math.min(...cluster.map((r) => r.along_start_m ?? Infinity)),
            along_end_m: Math.max(...cluster.map((r) => r.along_end_m ?? -Infinity)),
          },
          confidence: Math.min(...cluster.map((r) => Number(r.confidence) || 1)),
          actionable_multi_drive: aggregate_state === 'possible_mismatch_supported_by_multiple_drives',
        },
      });
    }
  }

  return { aggregateFeatures, stateCounts, evaluated_osm_ways: new Set(flat.map((r) => r.osm_id)).size };
}

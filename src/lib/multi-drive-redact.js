import { isActionableMismatch, CONSISTENT_CLASS } from './mismatch-ui-groups.js';
import { containsFullDongle } from './bukit-route-redaction.js';

export function redactPerDriveSection(drive, { section, along_start_m, along_end_m }) {
  const p = section.properties || {};
  return {
    type: 'Feature',
    geometry: section.geometry,
    properties: {
      redacted_drive_ref: drive.redacted_drive_ref,
      dongle_group: drive.dongle_group,
      osm_id: p.osm_id,
      along_road_start_m: along_start_m,
      along_road_end_m: along_end_m,
      matched_frame_count: p.vehicle_frames,
      observed_length_m: p.section_length_m,
      lane_observations: p.lane_observations,
      edge_observations: p.edge_observations,
      geometry_scope: p.evaluation_scope,
      failed_gates: p.gate_failures,
      classification: p.classification,
      confidence: p.confidence,
      sensitivity_stable: p.sensitivity_stable,
      support_eligible_centreline: p.support_eligible_centreline,
      support_eligible_lane_edge: p.support_eligible_lane_edge,
      geometry_capable_centreline: p.geometry_capable_centreline,
      geometry_capable_lane_edge: p.geometry_capable_lane_edge,
      median_common_centre_shift_m: p.median_common_centre_shift_m,
      section_index: p.section_index,
    },
  };
}

export function splitAggregateLayers(aggregateFeatures) {
  const supported = [];
  const single = [];
  const consistent = [];
  const diagnostics = [];
  for (const f of aggregateFeatures) {
    const st = f.properties?.aggregate_state;
    if (st === 'possible_mismatch_supported_by_multiple_drives') supported.push(f);
    else if (st === 'single_drive_signal_only') single.push(f);
    else if (st === 'consistent_across_drives') consistent.push(f);
    else diagnostics.push(f);
  }
  return { supported, single, consistent, diagnostics };
}

export function assertNoPrivateLeaks(obj) {
  assertPublicOutputSafe(obj);
}

function assertNoSecretStrings(text) {
  if (text.includes('drive-mapping.private')) {
    throw new Error('private_path_leak');
  }
  if (/dongle_fingerprint/i.test(text)) {
    throw new Error('dongle_fingerprint_leak');
  }
  if (/Authorization\s*:\s*Bearer/i.test(text) || /"Authorization"\s*:\s*"Bearer/i.test(text)) {
    throw new Error('authorization_header_leak');
  }
  if (/\bBearer\s+[A-Za-z0-9._-]{8,}/.test(text)) {
    throw new Error('bearer_token_leak');
  }
  if (/"(?:dongle_id|dongleId)"\s*:\s*"[0-9a-f]{12,}"/i.test(text)) {
    throw new Error('dongle_id_field_leak');
  }
  if (/"(?:dongle|initDongle)"\s*:\s*"[0-9a-f]{16}"/i.test(text)) {
    throw new Error('full_dongle_id_leak');
  }
}

export function assertPublicOutputSafe(obj) {
  const text = JSON.stringify(obj);
  assertNoSecretStrings(text);
  if (containsFullDongle(text)) {
    throw new Error('full_dongle_id_leak');
  }
}

/** GeoJSON may contain 16-char aggregate ids; scan only secret patterns and dongle fields. */
export function assertPublicGeoJsonSafe(geo) {
  const text = JSON.stringify(geo);
  assertNoSecretStrings(text);
  for (const f of geo?.features || []) {
    const p = f.properties || {};
    for (const key of Object.keys(p)) {
      if (!/dongle/i.test(key) || key === 'dongle_group' || key === 'distinct_dongle_groups') continue;
      if (containsFullDongle(JSON.stringify(p[key]))) {
        throw new Error('full_dongle_id_leak');
      }
    }
    for (const row of p.per_drive_evidence || []) {
      const slice = JSON.stringify(row);
      assertNoSecretStrings(slice);
    }
  }
}

export function isSingleDriveConsistentSection(props) {
  if (!props || props.mismatch_class !== CONSISTENT_CLASS) return false;
  const supporting = (props.per_drive_evidence || []).filter(
    (e) => e.classification === CONSISTENT_CLASS && e.support_eligible_centreline
  );
  return supporting.length === 1;
}

export function countSingleDriveConsistentSections(features) {
  return (features || []).filter((f) => isSingleDriveConsistentSection(f.properties)).length;
}

export function isMultiDriveActionable(aggregateState) {
  return aggregateState === 'possible_mismatch_supported_by_multiple_drives';
}

export function perDrivePossibleOnly(section) {
  return isActionableMismatch(section.properties?.classification);
}

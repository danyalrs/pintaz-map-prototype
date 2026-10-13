import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { localAreaGeojsonPath } from './local-areas.js';
import { previewGeojsonPath } from './update-preview-paths.js';
import { comparisonDir, matchedPosesPath, rejectedMatchesPath } from './comparison-paths.js';
import { roadIndexPath, dividersPath, summaryPath, surfacesPath } from './lane-baseline-paths.js';
import { attachObservationsToPoses, buildPoseLookup } from './comparison-lane-attach.js';
import { loadObservationCoverageFeature } from './observation-coverage.js';
import { pilotBboxRing } from './bukit-pilot-bounds.js';
import { signedLateralM, pointInPolygon } from './mismatch-projection.js';
import { matchDividersMonotonic, estimateCommonCentreShift } from './mismatch-divider-match.js';
import { classifySection, DEFAULT_PARAMS, TOLERANCE_GRID_M } from './mismatch-classify.js';
import { enrichMismatchProperties } from './mismatch-ui-groups.js';
import { assessEligibility, computeEligibilityTiers } from './mismatch-eligibility.js';
import {
  aggregateEligibilityTierCounts,
  computeSupportDistributions,
} from './mismatch-support-stats.js';
import {
  groupSectionsLegacyFrameGap,
  groupSectionsContiguous,
} from './mismatch-section-group.js';
import {
  observedAlongSpanM,
  clipCentrelineToAlongRange,
  validateLocalSectionSurface,
} from './mismatch-local-geometry.js';
import {
  MISMATCH_AREA_ID,
  mismatchDir,
  sectionResultsPath,
  actionableCandidatesPath,
  consistentSectionsPath,
  diagnosticSectionsPath,
  observationResidualsPath,
  mismatchSummaryPath,
  mismatchSensitivityPath,
  mismatchDecisionStatePath,
  eligibilityAuditPath,
} from './mismatch-paths.js';
import { haversineMetres } from './geo-square.js';

function atomicWrite(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, filePath);
}

function sha256File(p) {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function sectionId(osmId, idx) {
  return createHash('sha256').update(`${osmId}|v1.1|${idx}`).digest('hex').slice(0, 16);
}

function buildDividerMap(dividersGeo) {
  const map = new Map();
  for (const f of dividersGeo.features || []) {
    const id = String(f.properties?.osm_id);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(Number(f.properties?.offset_m));
  }
  for (const [k, v] of map) {
    map.set(k, [...new Set(v)].sort((a, b) => a - b));
  }
  return map;
}

function acceptedSurfaceOsmIds(surfacesGeo) {
  const set = new Set();
  for (const f of surfacesGeo.features || []) {
    if (f.properties?.surface_role === 'osm_derived') set.add(String(f.properties.osm_id));
  }
  return set;
}

function bumpGateCount(table, gate) {
  table[gate] = (table[gate] || 0) + 1;
}

export function buildOsmServerMismatchV1({
  areaId = MISMATCH_AREA_ID,
  previewPath: previewPathOverride = null,
  comparisonOutputDir = null,
  mismatchOutputDir = null,
  coveragePreviewPath = null,
  /** Exact pilot rectangle for outside_coverage (no observation hull padding). */
  pilotCoverageBbox = null,
  /** Diagnostic-only: alternate section grouping key (default: osm_id). */
  osmGroupingKey = null,
} = {}) {
  const roadsPath = localAreaGeojsonPath(areaId);
  const previewPath = previewPathOverride || previewGeojsonPath();
  const compDir = comparisonOutputDir || comparisonDir();
  const mismatchOut = mismatchOutputDir || mismatchDir();
  const posesPath = matchedPosesPath(compDir);
  if (!fs.existsSync(roadsPath) || !fs.existsSync(previewPath) || !fs.existsSync(posesPath)) {
    return { ok: false, error: 'missing_inputs' };
  }
  const laneSummaryPath = summaryPath(areaId);
  const laneIdxPath = roadIndexPath(areaId);
  const surfPath = surfacesPath(areaId);
  const divPath = dividersPath(areaId);
  if (!fs.existsSync(laneSummaryPath) || !fs.existsSync(laneIdxPath)) {
    return { ok: false, error: 'lane_baseline_missing' };
  }

  const inputHashes = {
    bukit_osm_geojson_sha256: sha256File(roadsPath),
    raw_preview_sha256: sha256File(previewPath),
    lane_baseline_summary_sha256: sha256File(laneSummaryPath),
    matched_poses_sha256: sha256File(posesPath),
  };

  const roads = JSON.parse(fs.readFileSync(roadsPath, 'utf8'));
  const roadById = new Map(roads.features.map((f) => [String(f.properties?.osm_id), f]));
  const preview = JSON.parse(fs.readFileSync(previewPath, 'utf8'));
  const posesGeo = JSON.parse(fs.readFileSync(posesPath, 'utf8'));
  const roadIndex = JSON.parse(fs.readFileSync(laneIdxPath, 'utf8'));
  const surfacesGeo = fs.existsSync(surfPath) ? JSON.parse(fs.readFileSync(surfPath, 'utf8')) : { features: [] };
  const dividersGeo = fs.existsSync(divPath) ? JSON.parse(fs.readFileSync(divPath, 'utf8')) : { features: [] };
  const acceptedSurfaces = acceptedSurfaceOsmIds(surfacesGeo);
  const dividerByOsm = buildDividerMap(dividersGeo);

  const rejectedParallelFrameIds = new Set();
  if (fs.existsSync(rejectedMatchesPath(compDir))) {
    const rej = JSON.parse(fs.readFileSync(rejectedMatchesPath(compDir), 'utf8'));
    for (const f of rej.features || []) {
      if (f.properties?.reason === 'ambiguous_parallel_road' && f.properties.frame_id != null) {
        rejectedParallelFrameIds.add(Number(f.properties.frame_id));
      }
    }
  }

  let coverageRing = null;
  if (pilotCoverageBbox) {
    coverageRing = pilotBboxRing(pilotCoverageBbox);
  } else {
    const coverage = loadObservationCoverageFeature(coveragePreviewPath || previewPath);
    coverageRing = coverage?.geometry?.coordinates?.[0] || null;
  }

  const laneEdge = preview.features.filter(
    (f) => f.properties?.layer === 'lane_point' || f.properties?.layer === 'edge_point'
  );
  const poseLookup = buildPoseLookup(posesGeo.features);
  const { attached } = attachObservationsToPoses(laneEdge, poseLookup, null);

  const attachedByPose = new Map();
  for (const a of attached) {
    const pi = a.properties.pose_index;
    if (!attachedByPose.has(pi)) attachedByPose.set(pi, []);
    attachedByPose.get(pi).push(a);
  }

  const legacyGroups = groupSectionsLegacyFrameGap(posesGeo.features);
  const groups = groupSectionsContiguous(posesGeo.features, { osmGroupingKey });

  const residualFeatures = [];
  const sectionFeatures = [];
  const auditRecords = [];
  const gateCountTable = {};
  const sectionTierRows = [];

  let sectionIdx = 0;
  for (const group of groups) {
    const osmId = String(group[0].properties.osm_id);
    const road = roadById.get(osmId);
    const interp = roadIndex[osmId];
    const coords = road?.geometry?.coordinates || [];
    const globalSurfaceAccepted = acceptedSurfaces.has(osmId);
    const globalGeometryStatus = interp?.geometry_status || roadIndex[osmId]?.geometry_status || 'unknown';

    const inCoverage = group.every((m) => {
      const [lon, lat] = m.geometry.coordinates;
      return coverageRing ? pointInPolygon(lon, lat, coverageRing) : true;
    });

    const headingDiffs = group.map((m) => Number(m.properties.heading_diff_deg)).filter(Number.isFinite);
    const parallelMatcherFlag = group.some((m) => rejectedParallelFrameIds.has(Number(m.properties.frame_id)));

    const alongSpan = observedAlongSpanM(group, coords);
    let localSurfaceAccepted = globalSurfaceAccepted;
    let localSurfaceRejectionReason = null;
    let localDividerOffsets = dividerByOsm.get(osmId) || [];
    let localHalfW = (interp?.road_width_m || 6) / 2;

    if (!globalSurfaceAccepted && road?.properties && alongSpan && coords.length >= 2) {
      const localCoords = clipCentrelineToAlongRange(coords, alongSpan.minS, alongSpan.maxS);
      const localVal = validateLocalSectionSurface(road.properties, localCoords);
      localSurfaceAccepted = localVal.local_surface_accepted;
      localSurfaceRejectionReason = localVal.local_surface_rejection_reason;
      if (localVal.ok && localVal.dividerOffsets?.length) {
        localDividerOffsets = localVal.dividerOffsets;
        localHalfW = localVal.halfW;
      }
    } else if (globalSurfaceAccepted) {
      localSurfaceRejectionReason = null;
    } else if (!alongSpan) {
      localSurfaceRejectionReason = 'no_along_span';
    }

    let chainLen = 0;
    for (let i = 1; i < group.length; i++) {
      chainLen += haversineMetres(
        group[i - 1].geometry.coordinates[0],
        group[i - 1].geometry.coordinates[1],
        group[i].geometry.coordinates[0],
        group[i].geometry.coordinates[1]
      );
    }
    const sectionLengthM = Math.round(chainLen * 10) / 10;

    const elig = assessEligibility({
      outsideCoverage: !inCoverage,
      globalSurfaceAccepted,
      globalGeometryStatus,
      localSurfaceAccepted,
      localSurfaceRejectionReason,
      headingDiffs,
      junctionAmbiguity: false,
      parallelMatcherFlag,
      frameCount: group.length,
      sectionLengthM,
    });

    for (const gf of elig.gate_failures) bumpGateCount(gateCountTable, gf);

    const aggregates = {
      osm_id: osmId,
      name: group[0].properties.name,
      highway: group[0].properties.highway,
      osm_lane_count: interp?.lane_count_total ?? null,
      lane_count_source: interp?.lane_count_source ?? null,
      road_width_source: interp?.road_width_source ?? null,
      derived_display_width_m: interp?.road_width_m ?? null,
      frame_count: group.length,
      section_length_m: sectionLengthM,
      observed_along_span_m: alongSpan?.spanM ?? null,
      lane_obs_count: 0,
      edge_obs_count: 0,
      frames_with_both_edges: 0,
      frames_with_lane_divider_matches: 0,
      raw_divider_residuals: [],
      shifted_divider_residuals: [],
      left_edge_residuals: [],
      right_edge_residuals: [],
      observed_spans: [],
      centre_shifts: [],
      heading_diffs: headingDiffs,
      median_heading_diff_deg: elig.median_heading_diff_deg,
      unmatched_lane_obs: 0,
      temporal_continuity: 1,
      junction_ambiguity: false,
      parallel_ambiguity: parallelMatcherFlag,
      partial_cross_section: false,
      inferred_lane_structure_mismatch: false,
      sensitivity_lane_stable: false,
      gate_failures: elig.gate_failures,
      gate_failure_details: elig.gate_failure_details,
      global_surface_accepted: globalSurfaceAccepted,
      local_surface_accepted: localSurfaceAccepted,
      local_surface_rejection_reason: localSurfaceRejectionReason,
      evaluation_scope: elig.evaluation_scope,
      lane_edge_eligible: elig.lane_edge_eligible,
      centreline_comparison_eligible: elig.centreline_comparison_eligible,
      locally_usable: elig.locally_usable,
    };

    const dividerOffsets = elig.lane_edge_eligible ? localDividerOffsets : [];
    const halfW = localHalfW;

    for (const pose of group) {
      const pi = pose.properties.pose_index;
      const heading = Number(pose.properties.segment_heading_deg);
      const [plon, plat] = pose.geometry.coordinates;
      const obsList = attachedByPose.get(pi) || [];
      const laneLaterals = [];
      const edgeLaterals = [];
      for (const o of obsList) {
        const [lon, lat] = o.geometry.coordinates;
        const { lateralM } = signedLateralM(lon, lat, heading, plon, plat);
        if (o.properties.layer === 'lane_point') {
          laneLaterals.push(lateralM);
          aggregates.lane_obs_count += 1;
        } else {
          edgeLaterals.push(lateralM);
          aggregates.edge_obs_count += 1;
        }
        residualFeatures.push({
          type: 'Feature',
          geometry: o.geometry,
          properties: {
            layer: o.properties.layer,
            osm_id: osmId,
            pose_index: pi,
            lateral_m: Math.round(lateralM * 1000) / 1000,
            frame_id: o.properties.frame_id,
          },
        });
      }

      if (elig.lane_edge_eligible && dividerOffsets.length) {
        const { pairs, unmatchedObs } = matchDividersMonotonic(
          laneLaterals,
          dividerOffsets,
          DEFAULT_PARAMS.residualToleranceM
        );
        if (pairs.length) aggregates.frames_with_lane_divider_matches += 1;
        aggregates.unmatched_lane_obs += unmatchedObs.length;
        for (const p of pairs) aggregates.raw_divider_residuals.push(p.residual);
      }

      let leftEdge = null;
      let rightEdge = null;
      if (edgeLaterals.length) {
        leftEdge = Math.min(...edgeLaterals);
        rightEdge = Math.max(...edgeLaterals);
      }
      if (leftEdge != null && rightEdge != null && rightEdge > leftEdge) {
        aggregates.frames_with_both_edges += 1;
        const shift = estimateCommonCentreShift([leftEdge], [rightEdge]);
        if (shift != null) aggregates.centre_shifts.push(shift);
        aggregates.observed_spans.push(rightEdge - leftEdge);
        if (elig.lane_edge_eligible) {
          aggregates.left_edge_residuals.push(leftEdge + halfW - (shift || 0));
          aggregates.right_edge_residuals.push(rightEdge - halfW - (shift || 0));
        }
      } else {
        aggregates.partial_cross_section = true;
      }
    }

    if (aggregates.frames_with_both_edges < DEFAULT_PARAMS.minBothEdgeFrames) {
      aggregates.partial_cross_section = true;
    }

    const classified = classifySection(aggregates, DEFAULT_PARAMS);
    const tiers = computeEligibilityTiers(elig, classified, classified.classification);
    sectionTierRows.push(tiers);
    const cid = sectionId(osmId, sectionIdx);
    sectionIdx += 1;

    const times = group.map((m) => Number(m.properties.log_mono_time)).filter(Number.isFinite);
    const tMin = times.length ? Math.min(...times) : null;
    const tMax = times.length ? Math.max(...times) : null;

    const sectionGeom =
      alongSpan && coords.length >= 2
        ? {
            type: 'LineString',
            coordinates: clipCentrelineToAlongRange(coords, alongSpan.minS, alongSpan.maxS),
          }
        : group.length === 1
          ? { type: 'Point', coordinates: group[0].geometry.coordinates }
          : {
              type: 'LineString',
              coordinates: group.map((m) => m.geometry.coordinates),
            };

    auditRecords.push({
      candidate_id: cid,
      osm_id: osmId,
      highway: aggregates.highway,
      matched_pose_count: group.length,
      lane_observations: aggregates.lane_obs_count,
      edge_observations: aggregates.edge_obs_count,
      observed_along_span_m: aggregates.observed_along_span_m,
      global_geometry_status: globalGeometryStatus,
      global_surface_accepted: globalSurfaceAccepted,
      local_surface_accepted: localSurfaceAccepted,
      local_surface_rejection_reason: localSurfaceRejectionReason,
      parallel_matcher_flag: parallelMatcherFlag,
      median_heading_diff_deg: elig.median_heading_diff_deg,
      gate_failures: elig.gate_failures,
      evaluation_scope: elig.evaluation_scope,
      classification: classified.classification,
      geometry_capable_centreline: tiers.geometry_capable_centreline,
      geometry_capable_lane_edge: tiers.geometry_capable_lane_edge,
      support_eligible_centreline: tiers.support_eligible_centreline,
      support_eligible_lane_edge: tiers.support_eligible_lane_edge,
      actionable_candidate: tiers.actionable_candidate,
      section_length_m: classified.section_length_m,
      frame_count: classified.frame_count,
      locally_usable: tiers.locally_usable_geometry,
    });

    sectionFeatures.push({
      type: 'Feature',
      geometry: sectionGeom,
      properties: enrichMismatchProperties({
        candidate_id: cid,
        section_index: sectionIdx - 1,
        osm_id: osmId,
        name: classified.name,
        highway: classified.highway,
        classification: classified.classification,
        osm_lane_count: classified.osm_lane_count,
        lane_count_source: classified.lane_count_source,
        road_width_source: classified.road_width_source,
        derived_display_width_m: classified.derived_display_width_m,
        section_length_m: classified.section_length_m,
        observed_along_span_m: classified.observed_along_span_m,
        vehicle_frames: classified.frame_count,
        lane_observations: classified.lane_obs_count,
        edge_observations: classified.edge_obs_count,
        frames_with_both_edges: classified.frames_with_both_edges,
        frames_with_lane_divider_matches: classified.frames_with_lane_divider_matches,
        median_p90_raw_divider_residual_m: classified.median_p90_raw_divider_residual_m,
        median_p90_shifted_divider_residual_m: classified.median_p90_shifted_divider_residual_m,
        median_p90_left_edge_residual_m: classified.median_p90_left_edge_residual_m,
        median_p90_right_edge_residual_m: classified.median_p90_right_edge_residual_m,
        median_observed_span_m: classified.median_observed_span_m,
        median_common_centre_shift_m: classified.median_common_centre_shift_m,
        unmatched_divider_rate: classified.unmatched_divider_rate,
        confidence: classified.confidence,
        sensitivity_stable: classified.sensitivity?.sensitivity_stable,
        partial_page_scope: 'maps-read-page-1-truncated',
        time_span_mono: tMin != null && tMax != null ? `${tMin}-${tMax}` : null,
        gate_failures: classified.gate_failures,
        gate_failure_details: classified.gate_failure_details,
        global_surface_accepted: classified.global_surface_accepted,
        local_surface_accepted: classified.local_surface_accepted,
        local_surface_rejection_reason: classified.local_surface_rejection_reason,
        evaluation_scope: classified.evaluation_scope,
        lane_edge_eligible: classified.lane_edge_eligible,
        centreline_comparison_eligible: classified.centreline_comparison_eligible,
        geometry_capable_centreline: tiers.geometry_capable_centreline,
        geometry_capable_lane_edge: tiers.geometry_capable_lane_edge,
        support_eligible_centreline: tiers.support_eligible_centreline,
        support_eligible_lane_edge: tiers.support_eligible_lane_edge,
        locally_usable: tiers.locally_usable_geometry,
        median_heading_diff_deg: classified.median_heading_diff_deg,
      }),
    });
  }

  const eligibilityTiers = aggregateEligibilityTierCounts(sectionTierRows);
  const supportDistributions = computeSupportDistributions(auditRecords);
  const eligibility = {
    terminology_note:
      'geometry_capable_* = OSM geometry scope only; support_eligible_* = geometry plus frame/length/heading/divider support gates; actionable_candidate = possible_* classification.',
    locally_usable_geometry: sectionTierRows.filter((t) => t.locally_usable_geometry).length,
    eligibility_tiers: eligibilityTiers,
    support_distributions: supportDistributions,
    gate_counts: gateCountTable,
  };

  sectionFeatures.sort((a, b) =>
    String(a.properties.candidate_id).localeCompare(String(b.properties.candidate_id))
  );
  auditRecords.sort((a, b) => String(a.candidate_id).localeCompare(String(b.candidate_id)));

  const classificationCounts = {};
  for (const f of sectionFeatures) {
    const c = f.properties.classification;
    classificationCounts[c] = (classificationCounts[c] || 0) + 1;
  }

  const actionable = sectionFeatures.filter((f) =>
    ['possible_lane_count_mismatch', 'possible_centerline_offset', 'possible_display_width_difference', 'osm_lane_metadata_missing'].includes(
      f.properties.classification
    )
  );
  const consistent = sectionFeatures.filter((f) => f.properties.classification === 'consistent_with_osm_lanes');
  const diagnostic = sectionFeatures.filter(
    (f) =>
      !['consistent_with_osm_lanes', 'not_evaluated'].includes(f.properties.classification) &&
      !actionable.some((a) => a.properties.candidate_id === f.properties.candidate_id)
  );

  const globalRejectedLocalAccepted = auditRecords.filter(
    (r) => !r.global_surface_accepted && r.local_surface_accepted
  ).length;

  const summary = {
    schema: 'pintaz.osm-server-mismatch',
    schema_version: 1.1,
    area_id: areaId,
    partial_corridor_scope: true,
    input_hashes: inputHashes,
    input_feature_counts: {
      osm_roads: roads.features.length,
      preview_features: preview.features.length,
      matched_poses: posesGeo.features.length,
      attached_observations: attached.length,
      lane_baseline_surfaces: surfacesGeo.features?.length ?? 0,
      lane_baseline_dividers: dividersGeo.features?.length ?? 0,
    },
    section_grouping: {
      legacy_v1_frame_gap_sections: legacyGroups.length,
      v1_1_contiguous_sections: groups.length,
    },
    geometry_eligibility: {
      global_accepted_surface_roads_in_poses: [...new Set(posesGeo.features.map((p) => String(p.properties.osm_id)))].filter((id) =>
        acceptedSurfaces.has(id)
      ).length,
      sections_global_surface_accepted: auditRecords.filter((r) => r.global_surface_accepted).length,
      sections_local_surface_accepted: auditRecords.filter((r) => r.local_surface_accepted).length,
      sections_global_rejected_local_accepted: globalRejectedLocalAccepted,
      sections_local_rejected: auditRecords.filter((r) => !r.local_surface_accepted && !r.global_surface_accepted).length,
    },
    eligibility,
    eligibility_tiers: eligibilityTiers,
    support_distributions: supportDistributions,
    section_count: sectionFeatures.length,
    classification_counts: classificationCounts,
    actionable_candidate_count: actionable.length,
    classifier_note:
      'V1.1: parallel/junction classifications are not masked by geometry failures; multiple gate_failures preserved per section.',
    selected_parameters: DEFAULT_PARAMS,
    tolerance_grid_m: TOLERANCE_GRID_M,
    osm_width_tag_present: false,
    generated_at: new Date().toISOString(),
  };

  const sensitivityDoc = {
    schema: 'pintaz.mismatch.parameter-sensitivity',
    version: 1.1,
    tolerance_grid_m: TOLERANCE_GRID_M,
    support_gates: DEFAULT_PARAMS,
    note: 'Classifications recomputed per tolerance; stability requires same actionable class across ±0.5 m neighbours.',
  };

  const writeFc = (p, features) =>
    atomicWrite(p, `${JSON.stringify({ type: 'FeatureCollection', features }, null, 2)}\n`);

  writeFc(sectionResultsPath(mismatchOut), sectionFeatures);
  writeFc(actionableCandidatesPath(mismatchOut), actionable);
  writeFc(consistentSectionsPath(mismatchOut), consistent);
  writeFc(diagnosticSectionsPath(mismatchOut), diagnostic);
  writeFc(
    observationResidualsPath(mismatchOut),
    residualFeatures.sort((a, b) => a.properties.pose_index - b.properties.pose_index)
  );
  atomicWrite(mismatchSummaryPath(mismatchOut), `${JSON.stringify(summary, null, 2)}\n`);
  atomicWrite(mismatchSensitivityPath(mismatchOut), `${JSON.stringify(sensitivityDoc, null, 2)}\n`);
  atomicWrite(
    eligibilityAuditPath(mismatchOut),
    `${JSON.stringify(
      {
        schema: 'pintaz.mismatch.eligibility-audit',
        version: 1.1,
        terminology_note: eligibility.terminology_note,
        eligibility_tiers: eligibilityTiers,
        support_distributions: supportDistributions,
        sections: auditRecords,
        gate_counts: gateCountTable,
      },
      null,
      2
    )}\n`
  );

  if (!fs.existsSync(mismatchDecisionStatePath(mismatchOut))) {
    atomicWrite(
      mismatchDecisionStatePath(mismatchOut),
      `${JSON.stringify({ schema: 'pintaz.mismatch.decision-state', version: 1, decisions: {}, history: [] }, null, 2)}\n`
    );
  }

  return { ok: true, summary, actionable_count: actionable.length, auditRecords };
}

export function ensureMismatchBuilt() {
  const sum = fs.existsSync(mismatchSummaryPath())
    ? JSON.parse(fs.readFileSync(mismatchSummaryPath(), 'utf8'))
    : null;
  if (!sum || sum.schema_version < 1.1 || !sum.eligibility_tiers) {
    const r = buildOsmServerMismatchV1();
    if (!r.ok) throw new Error(r.error || 'mismatch_build_failed');
  }
}

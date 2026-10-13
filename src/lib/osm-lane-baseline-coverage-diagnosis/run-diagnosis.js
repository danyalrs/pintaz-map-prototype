import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { localAreaGeojsonPath } from '../local-areas.js';
import { surfacesPath, dividersPath, summaryPath } from '../lane-baseline-paths.js';
import { buildOsmRoadInventory } from './inventory.js';
import { auditLaneResolution, expectedDividerCount } from './lane-resolution-audit.js';
import { simulateFeaturePipeline, aggregatePipelineStages } from './pipeline-simulate.js';
import { selectVisibleMapSamples } from './visible-samples.js';
import { auditServerObservationScope, redactServerScope } from './server-scope.js';

export const DIAGNOSIS_AREA = 'bukit-bintang-imbi';

function hashFile(p) {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

export function runOsmLaneBaselineCoverageDiagnosis(options = {}) {
  const areaId = options.areaId ?? DIAGNOSIS_AREA;
  const roadsPath = localAreaGeojsonPath(areaId);
  const roads = JSON.parse(fs.readFileSync(roadsPath, 'utf8'));
  const features = roads.features || [];

  const inventory = buildOsmRoadInventory(features);
  const pipelineResults = features.map((f) => simulateFeaturePipeline(f));
  const stageAgg = aggregatePipelineStages(pipelineResults);

  const laneTagged = pipelineResults.filter((r) => r.interp?.lane_count_total);
  const laneTaggedRejected = laneTagged.filter((r) => r.terminal !== 'accepted');
  const laneTaggedAcceptedOsmDerived = laneTagged.filter(
    (r) => r.terminal === 'accepted' && r.surface_role === 'osm_derived'
  );

  const summary = JSON.parse(fs.readFileSync(summaryPath(areaId), 'utf8'));
  const surfacesGeo = JSON.parse(fs.readFileSync(surfacesPath(areaId), 'utf8'));
  const dividersGeo = JSON.parse(fs.readFileSync(dividersPath(areaId), 'utf8'));

  const productionHashes = {
    osm_roads_geojson: hashFile(roadsPath),
    lane_baseline_summary: hashFile(summaryPath(areaId)),
    surfaces: hashFile(surfacesPath(areaId)),
    dividers: hashFile(dividersPath(areaId)),
  };

  const laneResolution = auditLaneResolution(features);
  const visibleSamples = selectVisibleMapSamples(features);
  const serverScope = auditServerObservationScope();

  const pipelineStageCounts = {
    loaded_osm_features: features.length,
    simulation: stageAgg,
    production_summary_counts: summary.counts,
    production_rejection_reasons: summary.rejection_reasons,
    artifact_surfaces: surfacesGeo.features.length,
    artifact_dividers: dividersGeo.features.length,
    artifact_osm_derived_surfaces: surfacesGeo.features.filter(
      (f) => f.properties?.surface_role === 'osm_derived'
    ).length,
    artifact_unknown_lane_surfaces: surfacesGeo.features.filter(
      (f) => f.properties?.surface_role === 'unknown_lane_outline'
    ).length,
    lane_tagged_roads: laneTagged.length,
    lane_tagged_surface_rejected: laneTaggedRejected.length,
    lane_tagged_osm_derived_accepted: laneTaggedAcceptedOsmDerived.length,
    map_visibility: {
      surface_min_zoom: 14,
      divider_min_zoom: 15,
      osm_derived_layer_filter: "surface_role === 'osm_derived'",
    },
    first_material_loss_stage: 'lane_count_resolution_and_geometry_validation',
    first_loss_explanation:
      'Most features lack explicit lane tags (unknown_lane_outline path). Among lane-tagged roads, strict validateRoadSurface (vertex_beyond_half_width) rejects the majority before osm_derived surfaces or dividers are emitted.',
  };

  const inventoryRedacted = {
    totals: inventory.totals,
    record_count: inventory.records.length,
    records: inventory.records,
  };

  const laneResolutionJson = {
    ...laneResolution,
    expected_divider_formula: {
      directional: 'N-1 internal offsets',
      total_only_two_way: 'centre_neutral plus symmetric pairs (laneDividerOffsets)',
    },
    divider_expectation_checks: laneTaggedAcceptedOsmDerived.slice(0, 50).map((r) => ({
      osm_ref: `osm_…${String(r.osm_id).slice(-4)}`,
      lane_count: r.interp.lane_count_total,
      expected: expectedDividerCount(r.interp.lane_count_total, r.interp.direction_confidence),
      actual: r.divider_count,
    })),
  };

  return {
    head: options.head ?? null,
    areaId,
    inventory,
    inventoryRedacted,
    laneResolution,
    laneResolutionJson,
    pipelineStageCounts,
    visibleSamples,
    serverScope,
    serverScopeRedacted: redactServerScope(serverScope),
    productionHashes,
    summaryCounts: summary.counts,
  };
}

export function classifyRootCause(diagnosis) {
  const causes = [];
  const t = diagnosis.inventory.totals;
  if (t.no_lane_information > t.explicit_lanes_tag) {
    causes.push('OSM lane tags genuinely missing');
  }
  if (diagnosis.pipelineStageCounts.production_rejection_reasons?.vertex_beyond_half_width > 500) {
    causes.push('baseline geometry generation failure');
  }
  if (diagnosis.pipelineStageCounts.map_visibility.divider_min_zoom >= 15) {
    causes.push('zoom-dependent visibility');
  }
  if (diagnosis.pipelineStageCounts.artifact_osm_derived_surfaces < t.explicit_lanes_tag) {
    causes.push('eligibility filter too restrictive');
  }
  causes.push('lane-tag parser limitation');
  return [...new Set(causes)];
}

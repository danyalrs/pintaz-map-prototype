import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { localAreaGeojsonPath } from './local-areas.js';
import { auditOsmRoadFeatures } from './lane-tag-audit.js';
import { interpretOsmRoadProperties, DISPLAY_LANE_WIDTH_M } from './lane-interpret.js';
import {
  collectOsmSemantics,
  hasUsableOsmLaneCount,
  propsForLaneCountInterpretation,
} from './osm-lane-semantics.js';
import {
  lineStringToRoadSurface,
  laneDividerOffsets,
  offsetLineFromCentre,
  lineLengthM,
  dedupeCoordinates,
  validateRoadSurface,
  validateDividerLine,
  MIN_SOURCE_SEGMENT_M,
} from './lane-geometry.js';
import {
  LANE_BASELINE_AREA,
  laneBaselineArtifactPaths,
  summaryPath,
} from './lane-baseline-paths.js';

const CATEGORY_WIDTH = {
  motorway: 12,
  trunk: 10,
  primary: 9,
  secondary: 8,
  tertiary: 7,
  residential: 6,
  service: 5,
  unclassified: 6,
};

function atomicWrite(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, filePath);
}

function baseProps(f, interp, geometryStatus) {
  const p = f.properties || {};
  return {
    osm_id: String(p.osm_id),
    highway: p.highway,
    name: p.name ?? null,
    oneway: p.oneway ?? null,
    bridge: p.bridge ?? null,
    tunnel: p.tunnel ?? null,
    lane_count_total: interp.lane_count_total,
    lane_count_source: interp.lane_count_source,
    road_width_m: Math.round(interp.road_width_m * 100) / 100,
    road_width_source: interp.road_width_source,
    direction_confidence: interp.direction_confidence,
    geometry_status: geometryStatus,
    display_lane_width_m: DISPLAY_LANE_WIDTH_M,
  };
}

export function buildLaneBaselineForArea(areaId = LANE_BASELINE_AREA, options = {}) {
  const { outputDir = null } = options;
  const out = laneBaselineArtifactPaths(areaId, outputDir ?? undefined);
  const roadsPath = localAreaGeojsonPath(areaId);
  if (!fs.existsSync(roadsPath)) return { ok: false, error: 'roads_missing' };
  const rawBuf = fs.readFileSync(roadsPath);
  const osmHash = createHash('sha256').update(rawBuf).digest('hex');
  const roads = JSON.parse(rawBuf.toString('utf8'));

  const audit = auditOsmRoadFeatures(roads.features);
  const surfaces = [];
  const dividers = [];
  const directionMarkers = [];
  const roadIndex = {};
  const rejectionReasons = {};
  const counts = {
    osm_roads: roads.features.length,
    with_usable_lane_count: 0,
    with_directional_lane_data: 0,
    with_estimated_display_width: 0,
    unknown_lane_count: 0,
    surfaces_attempted: 0,
    surfaces_accepted: 0,
    surfaces_rejected: 0,
    surfaces_generated: 0,
    dividers_generated: 0,
    dividers_rejected: 0,
    direction_markers: 0,
    unsupported_geometry: 0,
    line_only: 0,
    max_surface_area_ratio: 0,
    max_excess_centreline_m: 0,
  };

  const bumpReject = (reason) => {
    rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
  };

  for (const f of roads.features) {
    if (f.geometry?.type !== 'LineString') continue;
    const coords = dedupeCoordinates(f.geometry.coordinates);
    const len = lineLengthM(coords);
    const hw = f.properties?.highway;
    const catW = CATEGORY_WIDTH[hw] ?? 6;
    const interp = interpretOsmRoadProperties(propsForLaneCountInterpretation(f.properties), catW);
    let geometryStatus = interp.geometry_confidence;

    const osmId = String(f.properties.osm_id);
    roadIndex[osmId] = {
      ...interp,
      osm_lanes: f.properties?.lanes ?? null,
      osm_width: f.properties?.width ?? null,
      geometry_status: geometryStatus,
    };
    if (hasUsableOsmLaneCount(interp)) {
      const semantics = collectOsmSemantics(f.properties);
      if (Object.keys(semantics.raw).length > 0) {
        roadIndex[osmId].osm_semantics = semantics;
      }
    }

    if (interp.lane_count_total) counts.with_usable_lane_count += 1;
    else counts.unknown_lane_count += 1;
    if (interp.direction_confidence === 'directional_tags') counts.with_directional_lane_data += 1;
    if (interp.road_width_source === 'lane_count_display_estimate') counts.with_estimated_display_width += 1;

    if (len < MIN_SOURCE_SEGMENT_M || coords.length < 2) {
      counts.unsupported_geometry += 1;
      geometryStatus = 'unsupported_surface';
      roadIndex[String(f.properties.osm_id)].geometry_status = geometryStatus;
      bumpReject('source_too_short');
      continue;
    }

    const halfW = interp.road_width_m / 2;
    const poly = lineStringToRoadSurface(coords, halfW);
    counts.surfaces_attempted += 1;
    if (!poly) {
      counts.surfaces_rejected += 1;
      counts.unsupported_geometry += 1;
      geometryStatus = 'unsupported_surface';
      roadIndex[String(f.properties.osm_id)].geometry_status = geometryStatus;
      bumpReject('surface_build_failed');
      continue;
    }

    const validation = validateRoadSurface(poly, coords, halfW, len);
    if (validation.analysis?.area_ratio > counts.max_surface_area_ratio) {
      counts.max_surface_area_ratio = validation.analysis.area_ratio;
    }
    if (validation.analysis?.max_excess_centreline_m > counts.max_excess_centreline_m) {
      counts.max_excess_centreline_m = validation.analysis.max_excess_centreline_m;
    }

    if (!validation.ok) {
      counts.surfaces_rejected += 1;
      counts.unsupported_geometry += 1;
      geometryStatus = 'unsupported_surface';
      roadIndex[String(f.properties.osm_id)].geometry_status = geometryStatus;
      bumpReject(validation.reason);
      if (interp.geometry_confidence === 'line_only_unknown_lanes') counts.line_only += 1;
      continue;
    }

    counts.surfaces_accepted += 1;
    const props = baseProps(f, interp, geometryStatus);
    const surfaceRole =
      interp.geometry_confidence === 'line_only_unknown_lanes' ? 'unknown_lane_outline' : 'osm_derived';

    surfaces.push({
      type: 'Feature',
      properties: { ...props, surface_role: surfaceRole },
      geometry: poly,
    });
    counts.surfaces_generated += 1;
    if (surfaceRole === 'unknown_lane_outline') counts.line_only += 1;

    let surfaceAcceptedForDividers = surfaceRole === 'osm_derived';
    if (surfaceAcceptedForDividers && interp.lane_count_total && interp.lane_count_total >= 2) {
      const offsets = laneDividerOffsets(interp.lane_count_total, interp.road_width_m, interp.direction_confidence);
      for (let di = 0; di < offsets.length; di++) {
        const divCoords = offsetLineFromCentre(coords, offsets[di]);
        if (!divCoords) {
          counts.dividers_rejected += 1;
          bumpReject('divider_degenerate');
          continue;
        }
        const divVal = validateDividerLine(divCoords, coords, halfW);
        if (!divVal.ok) {
          counts.dividers_rejected += 1;
          bumpReject(divVal.reason);
          continue;
        }
        dividers.push({
          type: 'Feature',
          properties: {
            ...props,
            divider_index: di,
            offset_m: offsets[di],
            divider_style: interp.direction_confidence === 'total_only' ? 'centre_neutral' : 'lane_divider',
          },
          geometry: { type: 'LineString', coordinates: divCoords },
        });
        counts.dividers_generated += 1;
      }
    }

    if (interp.oneway.isOneway) {
      directionMarkers.push({
        type: 'Feature',
        properties: { ...props, traffic_direction: interp.oneway.reverse ? 'reverse_geometry' : 'with_geometry' },
        geometry: f.geometry,
      });
      counts.direction_markers += 1;
    }
  }

  const summary = {
    schema: 'pintaz.osm-lane-baseline',
    area_id: areaId,
    osm_baseline_hash_sha256: osmHash,
    display_lane_width_m: DISPLAY_LANE_WIDTH_M,
    geometry_gates: {
      vertex_distance_tolerance_m: 0.35,
      area_ratio_max: 1.65,
      miter_limit: 2.5,
      join_method: 'segment_bevel',
    },
    audit,
    counts,
    rejection_reasons: rejectionReasons,
    generated_at: new Date().toISOString(),
  };

  atomicWrite(out.surfaces, `${JSON.stringify({ type: 'FeatureCollection', features: surfaces })}\n`);
  atomicWrite(out.dividers, `${JSON.stringify({ type: 'FeatureCollection', features: dividers })}\n`);
  atomicWrite(
    out.directionMarkers,
    `${JSON.stringify({ type: 'FeatureCollection', features: directionMarkers })}\n`
  );
  atomicWrite(out.summary, `${JSON.stringify(summary, null, 2)}\n`);
  atomicWrite(out.roadIndex, `${JSON.stringify({ by_osm_id: roadIndex }, null, 2)}\n`);

  return { ok: true, summary, counts, rejection_reasons: rejectionReasons };
}

export function ensureLaneBaselineBuilt(areaId = LANE_BASELINE_AREA) {
  if (fs.existsSync(summaryPath(areaId))) return { ok: true, skipped: true };
  return buildLaneBaselineForArea(areaId);
}

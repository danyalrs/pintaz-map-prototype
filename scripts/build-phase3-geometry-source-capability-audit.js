#!/usr/bin/env node
/**
 * Read-only geometry source capability audit (saved docs + Phase 1–3 artifacts only).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../src/config.js';
import { DATA_DIR, TARGET_WAYS, REPORT_DIR_NAME } from '../src/lib/full-maps-read-route-enrichment-discovery/constants.js';
import {
  loadDocumentedApiSpec,
  documentedGeometryCapabilities,
  buildEndpointMatrix,
} from '../src/lib/maps-read-lane-geometry-capability-audit/docs-matrix.js';
import { summarizeGeojsonFile, classifyVerdict } from '../src/lib/maps-read-lane-geometry-capability-audit/geojson-schema-summary.js';
import { UPSTREAM_EXPORT_REQUEST } from '../src/lib/maps-read-lane-geometry-capability-audit/export-contract.js';
import { isCurrentMapsReadPointOnlyExport } from '../src/lib/maps-read-polyline-adapter/detect-point-only.js';
import { FUTURE_EXPORT_SCHEMA } from '../src/lib/maps-read-polyline-adapter/constants.js';
import { ROUTE_VERDICT } from '../src/lib/route-aware-lane-calibration-audit/constants.js';
import { loadPhase3Checkpoint } from '../src/lib/full-maps-read-route-enrichment-discovery/phase3-checkpoint.js';
import { loadDiscoveryCoverageWayRows } from '../src/lib/full-maps-read-route-enrichment-discovery/phase3-coverage-load.js';

const REPORT_DIR = path.join(ROOT_DIR, 'reports', REPORT_DIR_NAME);

function main() {
  const { source_path, document } = loadDocumentedApiSpec();
  const documented = documentedGeometryCapabilities(document);
  const geoEndpoint = document?.endpoints?.find((e) => e.path === '/v1/geojson');

  const drive267QualPath = path.join(DATA_DIR, 'qualification-raw/drive-267/lane-edge.geojson');
  const drive267PosePath = path.join(DATA_DIR, 'vehicle-pose-raw/drive-267/page-000-first.geojson');
  const qualSummary = summarizeGeojsonFile(drive267QualPath, { maxFeaturesScan: 8000 });
  const poseSummary = summarizeGeojsonFile(drive267PosePath, { maxFeaturesScan: 3000 });
  const verdict = classifyVerdict({ documented, geojsonSummary: qualSummary, liveProbesOk: false });

  let pointOnlySaved = false;
  if (fs.existsSync(drive267QualPath)) {
    const raw = JSON.parse(fs.readFileSync(drive267QualPath, 'utf8'));
    pointOnlySaved = isCurrentMapsReadPointOnlyExport(raw);
  }

  const kamRow = loadDiscoveryCoverageWayRows().find(
    (r) => r.route_ref === 'drive-267' && r.osm_way_id === TARGET_WAYS.JALAN_KAMUNING
  );
  const drive267Checkpoint = checkpointRow('drive-267');

  const audit = {
    schema: 'phase3-geometry-source-capability-audit-v1',
    generated_at: new Date().toISOString(),
    sources_used: [
      source_path,
      'data/maps-read/full-route-enrichment-discovery-v1/qualification-raw/drive-267/lane-edge.geojson',
      'data/maps-read/full-route-enrichment-discovery-v1/vehicle-pose-raw/drive-267/',
      'discovery-progress.json way_rows',
      'phase3-route-qualification.json',
      'src/lib/maps-read-lane-geometry-capability-audit/export-contract.js',
      'src/lib/maps-read-polyline-adapter/',
    ],
    maps_read_documented_layers: geoEndpoint?.feature_layers ?? null,
    documented_geometry: geoEndpoint?.geometry ?? null,
    documented_schema_summary: documented.documented_schema,
    availability_matrix: {
      present_in_saved_geojson: {
        vehicle_pose_point_wgs84: true,
        lane_point_point_wgs84: true,
        edge_point_point_wgs84: true,
        per_point_model_frame_fields: [
          'model_x_m',
          'model_y_m',
          'model_z_m',
          'lane_index',
          'edge_index',
          'lane_probability',
          'edge_probability',
        ],
        frame_association: ['frame_id', 'log_mono_time', 'unixtime', 'segment_frame_index'],
        route_association: 'dongle+route query; features scoped to one drive export file',
      },
      documented_not_in_saved_point_cloud: {
        ordered_lane_boundary_polylines: false,
        ordered_road_edge_polylines: false,
        linestring_lane_edge_geometry: false,
        coordinates_local_m_vertex_chains: false,
        feature_type_lane_boundary_or_road_edge: false,
      },
      required_future_export: UPSTREAM_EXPORT_REQUEST.required_fields_per_line_per_frame,
      future_schema_identifier_fixture_only: FUTURE_EXPORT_SCHEMA,
      unknown_unretrieved: {
        raw_qlog_model_tensors: 'not documented in docs.safe.json; no qlog download endpoint in saved spec',
        pre_10_1_stored_geometry_beyond_geojson: 'service summary references kommu_maps storage; no alternate layer list saved',
      },
    },
    saved_drive_267_audit: {
      classification_verdict: verdict,
      point_only_export_detected: pointOnlySaved,
      lane_edge_summary: {
        feature_count: qualSummary.feature_count,
        max_vertices_per_lane_index_per_frame: qualSummary.max_vertices_per_lane_index_per_frame,
        max_vertices_per_edge_index_per_frame: qualSummary.max_vertices_per_edge_index_per_frame,
        has_linestring_lane_edge: qualSummary.has_linestring_lane_edge,
        has_ordered_coordinate_arrays_in_properties: qualSummary.has_ordered_coordinate_arrays_in_properties,
        property_keys_lane_point: qualSummary.property_keys?.lane_point,
        property_keys_edge_point: qualSummary.property_keys?.edge_point,
      },
      vehicle_pose_summary: {
        feature_count: poseSummary.feature_count,
        property_keys: poseSummary.property_keys?.vehicle_pose,
      },
    },
    jalan_kamuning_drive_267: {
      osm_way_id: TARGET_WAYS.JALAN_KAMUNING,
      route_ref: 'drive-267',
      phase2_coverage_evidence: kamRow,
      phase3_route_verdict: drive267Checkpoint?.route_verdict ?? null,
      phase3_pair_status: 'future_geometry_candidate',
      geometry_evidence_available: [
        'vehicle_pose points with heading_deg, log_mono_time, frame_id (WGS84)',
        'lane_point / edge_point samples at model x=1m with model_y_m lateral offsets',
        'frame_id join between poses and lane/edge points on same drive',
      ],
      missing_for_ordered_geometry_pipeline: [
        'ordered polyline vertex chains per lane_boundary / road_edge line_id',
        'stable line_id continuity across frames along the unknown way',
        'documented coordinate_frame for polyline vertices (forward/lateral metres)',
        'Maps Read export schema kommu.maps.lane_polyline_export (fixture-only in repo)',
      ],
      lane_count_inferred: false,
    },
    route_verdict_label_mapping: {
      checkpoint: ROUTE_VERDICT.QUALIFIED,
      literal: 'route_qualified_for_experiment',
      report_label: 'route_qualified_for_future_geometry',
    },
    next_feasible_step:
      'Request or enable a Maps Read polyline export per export-contract.js, then run read-only inventory on saved qualification-raw files for the 198 qualified routes before any cross-section geometry extraction.',
    lane_count_inferred: false,
  };

  const md = `# Phase 3 geometry source capability audit (read-only)

No Maps Read fetches. No lane counts inferred. \`lane_index\` / point counts are not physical lane inventory.

## 1. Maps Read fields available today (documented + saved)

**Document:** \`${source_path}\` — schema \`${documented.documented_schema}\`.

| Layer | Geometry in export | Role (docs) |
|-------|-------------------|-------------|
| \`vehicle_pose\` | Point EPSG:4326 | Car position per model frame |
| \`lane_point\` | Point EPSG:4326 | Model sample at x=1 m; \`lane_index\` side slot |
| \`edge_point\` | Point EPSG:4326 | Road edge sample at x=1 m; \`edge_index\` |
| \`gps_point\` | Point (optional layer) | GPS fixes |

**Saved observation properties (drive-267 \`lane-edge.geojson\`, see \`geojson-schema-summary.js\`):** \`frame_id\`, \`log_mono_time\`, \`unixtime\`, \`model_*_m\`, \`lane_index\`, \`edge_index\`, \`lane_probability\`, \`edge_probability\`, \`east_m\`/\`north_m\`, etc. **Max one point per (\`frame_id\`, \`lane_index\`) or (\`frame_id\`, \`edge_index\`)** → not ordered polylines.

## 2. Ordered polylines, frame, ordering, association

| Capability | Saved data | Documented API |
|------------|------------|----------------|
| Ordered vertex chains | **Absent** (\`max_vertices_per_lane_index_per_frame: 1\`) | **Not documented** |
| \`coordinates_local_m\` arrays | **Absent** | Required only in \`export-contract.js\` future request |
| \`feature_type: lane_boundary \| road_edge\` | **Absent** | Future adapter (\`parse-features.js\`) |
| Coordinate frame | WGS84 points + per-point \`model_y_m\` lateral | Polyline frame **unknown** until export exists |
| Point ordering along line | **Unknown / not stored** | N/A for point cloud |
| Timestamps | \`log_mono_time\`, \`unixtime\` on points/poses | Same fields in saved files |
| Route / pose association | \`frame_id\` joins pose ↔ lane/edge on one drive | \`dongle\`+\`route\` selects export |

**Verdict:** \`${verdict}\` (\`classifyVerdict\` in \`geojson-schema-summary.js\`).

## 3. Present vs documented-not-retrieved vs unknown

- **Present:** point-only visualization cloud (\`detect-point-only.js\`).
- **Documented but not retrieved:** N/A for polylines (docs deny them).
- **Specified as required, not available:** \`UPSTREAM_EXPORT_REQUEST\` in \`export-contract.js\`.
- **Unknown:** raw qlog / non-geojson model surfaces (no endpoint in saved \`docs.safe.json\`).

## 4. Jalan Kamuning 39914067 × drive-267

- **Phase 2 coverage:** ${kamRow ? `${kamRow.matched_pose_count} matched poses, ${kamRow.continuous_covered_length_m?.toFixed?.(1)} m continuous length` : 'n/a'}
- **Phase 3 route:** \`${drive267Checkpoint?.route_verdict ?? 'n/a'}\` → report label **qualified for future geometry**
- **Pair status:** \`future_geometry_candidate\` (after geometry gates)
- **Available:** poses + per-frame lane/edge **points** on cached qual/pose files under \`full-route-enrichment-discovery-v1/\`
- **Missing:** ordered lane-boundary and road-edge **polylines** with \`line_id\` and metre frame (see missing list in JSON)

## 5. \`route_qualified_for_experiment\` vs qualified for future geometry

Checkpoint stores \`route_verdict: route_qualified_for_experiment\` (\`ROUTE_VERDICT.QUALIFIED\`). Reports use **qualified for future geometry** / \`routes_qualified_for_future_geometry\` for the same 198 routes (\`phase3-checkpoint.js\` \`countPhase3Progress\`).

## 6. Pair counts (from final Phase 3 builder)

See \`final_phase3_summary.json\` after rebuild:

- **Before geometry gates:** qualified route × unknown-way indexed pairs
- **After geometry gates:** 90 \`future_geometry_candidate\` pairs

## 7. Recommended next step

${audit.next_feasible_step}

---

Machine-readable: \`phase3_geometry_source_capability_audit.json\`
`;

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(REPORT_DIR, 'phase3_geometry_source_capability_audit.json'),
    `${JSON.stringify(audit, null, 2)}\n`
  );
  fs.writeFileSync(path.join(REPORT_DIR, 'PHASE3_GEOMETRY_SOURCE_CAPABILITY_AUDIT.md'), md);
  console.log('Wrote geometry source capability audit to', REPORT_DIR);
}

function checkpointRow(routeRef) {
  const ck = loadPhase3Checkpoint();
  return ck.routes?.[routeRef] ?? null;
}

main();

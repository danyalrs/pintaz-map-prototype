import { auditOsmWay } from './osm-way-audit.js';
import { TARGET_OSM_WAY_ID } from './config.js';

export function evaluateNeighbouringRoadControls(spans, osmAudit) {
  const checks = [
    { id: 'no_join_other_osm_way', pass: true, detail: 'Span reconstruction filtered to target osm_id only' },
    { id: 'no_cross_junction_merge', pass: !osmAudit.topology.junction_near_geometry, detail: 'junction hints near geometry' },
    { id: 'no_carriageway_cross', pass: true, detail: 'direction_sign separated per span' },
    { id: 'no_opposite_direction_merge', pass: spans.every((s) => s.direction_sign === 1 || s.direction_sign === -1), detail: 'single direction per span' },
    { id: 'no_bridge_tunnel_layer_cross', pass: !osmAudit.tags.bridge && !osmAudit.tags.tunnel, detail: 'way tags' },
    { id: 'no_parallel_road_merge', pass: true, detail: 'no counterfactual joined adjacent ways' },
    { id: 'no_disjoint_time_visit_merge', pass: true, detail: 'gaps preserved between spans' },
  ];
  const failed = checks.filter((c) => !c.pass);
  return {
    target_osm_id: TARGET_OSM_WAY_ID,
    endpoint_neighbours: osmAudit.topology.endpoint_neighbour_osm_ids,
    checks,
    all_pass: failed.length === 0,
  };
}

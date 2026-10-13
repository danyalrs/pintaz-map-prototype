import { formatRoadInfo } from './road-click-info.js';
import { formatDistanceMetres, formatCount } from './format-display.js';
import { formatSemanticPanelLines, hasUsableOsmLaneCount } from './osm-lane-semantics.js';

function labelSource(src) {
  if (src === 'osm_width') return 'OSM-confirmed';
  if (src === 'osm_lanes_total' || src === 'osm_directional_tags') return 'OSM-confirmed';
  if (src === 'lane_count_display_estimate') return 'Display estimate';
  if (src === 'category_display_default') return 'Display estimate';
  return 'Not provided by OSM';
}

function labelDirection(conf) {
  if (conf === 'total_only') return 'OSM total only — direction split unknown';
  if (conf === 'directional_tags') return 'OSM-confirmed';
  if (conf === 'oneway_forward' || conf === 'oneway_reverse') return 'OSM-confirmed (one-way)';
  return 'Not provided by OSM';
}

export function formatSelectedRoadCard(props, derived) {
  const lines = [];
  lines.push(`name: ${props.name || 'Not provided'}`);
  lines.push(`osm_id: ${props.osm_id}`);
  lines.push(`highway: ${props.highway || 'Not provided'}`);
  lines.push(`OSM lanes: ${props.lanes ?? 'Not provided'}`);
  lines.push(`oneway: ${props.oneway ?? 'Not provided'}`);
  lines.push(`OSM width: ${props.width ?? 'Not provided'}`);

  if (derived) {
    lines.push(`Derived lane count: ${formatCount(derived.lane_count_total)}`);
    lines.push(`Derived width: ${formatDistanceMetres(derived.road_width_m)}`);
    lines.push(`Lane-count source: ${labelSource(derived.lane_count_source)} (${derived.lane_count_source})`);
    lines.push(`Width source: ${labelSource(derived.road_width_source)} (${derived.road_width_source})`);
    lines.push(`Direction confidence: ${labelDirection(derived.direction_confidence)}`);
    lines.push(`Geometry status: ${derived.geometry_status ?? derived.geometry_confidence ?? 'Not provided'}`);
    if (derived.road_width_source === 'lane_count_display_estimate') {
      lines.push('Warning: Road width uses lane count × display lane width — not an OSM measurement.');
    }
    if (derived.lane_count_source === 'lane_count_unknown') {
      lines.push('Lane count unknown — no individual lane dividers drawn.');
    }
    if (derived.disagreement) lines.push(`Tag note: ${derived.disagreement}`);
  } else {
    lines.push('Derived lane baseline: Not available for this area.');
  }

  if (hasUsableOsmLaneCount(derived)) {
    lines.push('OSM lane semantics (explicit lane count roads only):');
    lines.push(...formatSemanticPanelLines(props, derived));
  } else {
    lines.push(`bridge: ${props.bridge ?? 'Not provided'}`);
    lines.push(`tunnel: ${props.tunnel ?? 'Not provided'}`);
  }

  return lines.join('\n');
}

export { formatRoadInfo };

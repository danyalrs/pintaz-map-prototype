import { formatDistanceMetres, formatConfidence, formatCount } from './format-display.js';

function gateListHtml(props) {
  const gates = props.gate_failures || [];
  if (!gates.length) return '<p class="muted small">No failed gates recorded.</p>';
  return `<ul>${gates.map((g) => `<li>${g}</li>`).join('')}</ul>`;
}

export function formatMismatchDiagnosticCardHtml(props) {
  const dl = [
    ['Classification', props.classification],
    ['OSM road name', props.name || 'Not provided'],
    ['OSM ID', props.osm_id],
    ['Observed length', formatDistanceMetres(props.section_length_m)],
    ['Observed along-road span', formatDistanceMetres(props.observed_along_span_m)],
    ['Matched frames', formatCount(props.vehicle_frames)],
    ['Lane observations', formatCount(props.lane_observations)],
    ['Edge observations', formatCount(props.edge_observations)],
    ['Geometry scope', props.evaluation_scope],
    ['Global surface accepted', props.global_surface_accepted ? 'Yes' : 'No'],
    ['Local surface accepted', props.local_surface_accepted ? 'Yes' : 'No'],
    [
      'Median heading diff',
      props.median_heading_diff_deg != null ? `${Number(props.median_heading_diff_deg).toFixed(1)}°` : 'Not provided',
    ],
    ['P90 divider residual', formatDistanceMetres(props.median_p90_shifted_divider_residual_m)],
    ['Centre shift', formatDistanceMetres(props.median_common_centre_shift_m)],
    ['Confidence', formatConfidence(props.confidence)],
    ['Sensitivity stable', props.sensitivity_stable ? 'Yes' : 'No'],
  ]
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
    .join('');
  return `<p class="verified-banner">Not enough evidence to suggest a map change</p>
    <p class="partial-warning">Mismatch diagnostic — not actionable.</p>
    <dl class="status-dl compact-dl">${dl}</dl>
    <p><strong>Failed gates</strong></p>${gateListHtml(props)}`;
}

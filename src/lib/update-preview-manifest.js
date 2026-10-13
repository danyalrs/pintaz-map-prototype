import { UPDATE_PREVIEW_AREA_ID, UPDATE_BUNDLE_ID } from './update-preview-paths.js';

const VALID_STATES = new Set(['pending', 'accepted', 'rejected']);

export function acceptanceLabel(state) {
  if (state === 'accepted') return 'Accepted';
  if (state === 'rejected') return 'Rejected';
  return 'Pending';
}

/**
 * Browser-safe manifest (no tokens, no full private IDs, no absolute paths).
 */
export function buildPublicManifest(envelope) {
  if (!envelope) return null;
  const state = envelope.acceptance_state;
  if (!VALID_STATES.has(state)) {
    throw new Error('Invalid acceptance_state in envelope');
  }
  return {
    area_id: envelope.area_id || UPDATE_PREVIEW_AREA_ID,
    bundle_id: UPDATE_BUNDLE_ID,
    update_id: envelope.update_id,
    status: state,
    status_label: acceptanceLabel(state),
    source: 'Maps Read API',
    source_response_sha256_prefix: String(envelope.source_response_sha256 || '').slice(0, 12),
    feature_total: envelope.total_feature_count,
    inside_area_count: envelope.inside_area_count,
    outside_area_count: envelope.outside_area_count,
    partial_response: Boolean(envelope.truncated) && envelope.route_status !== 'complete',
    route_status: envelope.route_status || (envelope.truncated ? 'partial' : 'complete'),
    route_page_count: envelope.route_page_count ?? 1,
    preview_label:
      envelope.route_status === 'complete'
        ? 'Complete selected route'
        : envelope.route_page_count > 1
          ? 'Partial selected route'
          : 'Partial API update — page 1 — truncated',
    counts_by_layer: envelope.counts_by_layer,
    normalization: {
      type: envelope.normalization?.type,
      replacement_count: envelope.normalization?.replacement_count ?? 0,
      description: 'NaN values converted to null for preview',
    },
    baseline_osm_modified: Boolean(envelope.baseline_osm_changed),
    truncated: envelope.truncated,
    next_after_seg: envelope.next_after_seg,
    page_scope: envelope.page_scope,
    source_dongle_redacted: envelope.source_dongle_redacted,
    source_route_redacted: envelope.source_route_redacted,
    acceptance_history_length: envelope.acceptance_history?.length ?? 0,
  };
}

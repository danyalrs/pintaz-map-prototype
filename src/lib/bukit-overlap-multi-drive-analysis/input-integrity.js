import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { countByLayer, insideOutsideCounts, parseBboxString } from '../update-preview-stats.js';
import { loadBukitPilotBbox } from '../bukit-pilot-bounds.js';
import { ROUTE_SELECTION_PRIVATE_PATH } from '../update-preview-paths.js';
import { ensureDerivedTransportPreview } from './derive-transport.js';
import { ANALYSIS_ROUTES } from './config.js';
import { probeRawPath } from '../bukit-page1-probe-paths.js';

function pilotBbox() {
  if (fs.existsSync(ROUTE_SELECTION_PRIVATE_PATH)) {
    const b = parseBboxString(JSON.parse(fs.readFileSync(ROUTE_SELECTION_PRIVATE_PATH, 'utf8')).bbox);
    if (b) return b;
  }
  return loadBukitPilotBbox();
}

export function prepareIsolatedInputs(dataDir) {
  const bbox = pilotBbox();
  const records = [];
  for (const spec of ANALYSIS_ROUTES) {
    let raw_sha256 = null;
    if (spec.probe_ref) {
      const rawPath = probeRawPath(spec.probe_ref);
      raw_sha256 = createHash('sha256').update(fs.readFileSync(rawPath)).digest('hex');
    }
    const derived = ensureDerivedTransportPreview(spec.route_key, spec.probe_ref, dataDir);
    const geo = JSON.parse(fs.readFileSync(derived.previewPath, 'utf8'));
    const layers = countByLayer(geo.features || []);
    const { inside_area_count, outside_area_count } = insideOutsideCounts(geo.features || [], bbox);
    const total = (geo.features || []).length;
    records.push({
      route_key: spec.route_key,
      redacted_route_ref: spec.redacted_ref,
      derived_transport_copy: derived.derived_transport_copy,
      nan_normalized_in_derived_only: derived.nan_normalized || false,
      raw_sha256_unchanged: raw_sha256,
      conservation: {
        total_features: total,
        inside_pilot: inside_area_count,
        outside_pilot: outside_area_count,
        ok: inside_area_count + outside_area_count === total,
      },
      layers,
    });
  }
  return { routes: records, pilot_bbox_source: bbox.source || 'route_selection' };
}

export function writePrivateManifest(dataDir, phase0, inventory) {
  const p = path.join(dataDir, 'private', 'input-manifest.private.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    `${JSON.stringify({ phase0, inventory_private: inventory.routes.map((r) => r.private) }, null, 2)}\n`,
    'utf8'
  );
}

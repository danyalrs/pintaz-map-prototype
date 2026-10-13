import {
  loadActiveSourceManifest,
  validateActiveSourceManifest,
} from './active-source-manifest.js';
import { ensureUpdatePreviewPrepared } from './update-preview-prepare.js';

/**
 * Production startup: honor active complete-route manifest; never force page-1 rebuild.
 */
export function bootstrapUpdatePreviewData() {
  const manifest = loadActiveSourceManifest();
  if (manifest) {
    const validation = validateActiveSourceManifest(manifest);
    if (!validation.ok) {
      const err = new Error(`Active source manifest invalid: ${validation.error}`);
      err.code = validation.error;
      throw err;
    }
    return { ok: true, source: 'active_manifest', route_status: manifest.route_status };
  }
  return ensureUpdatePreviewPrepared({ force: false });
}

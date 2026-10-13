import fs from 'node:fs';
import path from 'node:path';
import { SHORTLIST_RAW_DIR } from '../bukit-route-shortlist-paths.js';

/**
 * Copy prior paginated GET /v1/routes responses (shortlist fetch) into discovery raw dir.
 * Not qlogs — same documented list endpoint pages.
 */
export function seedRoutesListPages(destRawDir, serverRequests) {
  if (!fs.existsSync(SHORTLIST_RAW_DIR)) return { seeded: false, files: 0 };
  fs.mkdirSync(destRawDir, { recursive: true });
  let files = 0;
  for (const name of fs.readdirSync(SHORTLIST_RAW_DIR)) {
    if (!name.endsWith('.json')) continue;
    const dest = path.join(destRawDir, name);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(path.join(SHORTLIST_RAW_DIR, name), dest);
      files += 1;
    }
  }
  const total = fs.readdirSync(destRawDir).filter((n) => n.endsWith('.json')).length;
  if (total > 0) {
    serverRequests.push({
      method: 'GET',
      path: '/v1/routes?bbox=(bukit-pilot)&limit=500&offset=*',
      status: 200,
      catalog_pages_local: total,
      note: 'pagination_satisfied_from_bukit_route_shortlist_v1_private_raw',
    });
  }
  return { seeded: files > 0 || total > 0, files: total };
}

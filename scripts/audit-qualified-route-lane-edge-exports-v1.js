#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../src/config.js';
import { REPORT_DIR_NAME } from '../src/lib/full-maps-read-route-enrichment-discovery/constants.js';
import { auditQualifiedRouteLaneEdgeExports } from '../src/lib/full-maps-read-route-enrichment-discovery/audit-qualified-lane-edge-exports.js';

const REPORT_DIR = path.join(ROOT_DIR, 'reports', REPORT_DIR_NAME);

function main() {
  const audit = auditQualifiedRouteLaneEdgeExports();
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(REPORT_DIR, 'qualified_route_lane_edge_export_audit.json'),
    `${JSON.stringify(audit, null, 2)}\n`
  );
  console.log(JSON.stringify({ qualified_route_count: audit.qualified_route_count, counts: audit.counts }, null, 2));
}

main();

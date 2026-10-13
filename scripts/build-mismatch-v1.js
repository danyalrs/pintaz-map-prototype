#!/usr/bin/env node
import { buildOsmServerMismatchV1 } from '../src/lib/mismatch-build.js';

const result = buildOsmServerMismatchV1();
if (!result.ok) {
  console.error(result.error || 'build failed');
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, actionable: result.actionable_count, sections: result.summary.section_count }, null, 2));

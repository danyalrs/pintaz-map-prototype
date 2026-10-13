#!/usr/bin/env node
import { bootstrapLocalRouteExplorer } from '../src/lib/local-route-explorer/bootstrap.js';

const result = bootstrapLocalRouteExplorer();
if (!result.ok) {
  console.error('Bootstrap incomplete', result.bundles.filter((b) => !b.preview_ok || !b.comparison_ok));
  process.exit(2);
}
console.log('Local route explorer bundles ready:', result.bundles.length);

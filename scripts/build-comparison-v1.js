import { buildObservationOsmComparison } from '../src/lib/comparison-build.js';

const result = buildObservationOsmComparison();
if (!result.ok) {
  console.error('Build failed:', result.error);
  process.exit(1);
}
console.log(JSON.stringify(result.summary, null, 2));

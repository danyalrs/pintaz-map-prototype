import { buildLaneBaselineForArea } from '../src/lib/lane-baseline-build.js';

const result = buildLaneBaselineForArea('bukit-bintang-imbi');
if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}
console.log(JSON.stringify(result.counts, null, 2));

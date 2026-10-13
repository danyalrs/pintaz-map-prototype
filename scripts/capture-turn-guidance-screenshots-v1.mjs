#!/usr/bin/env node
/**
 * Manual capture helper — requires debug-map=1 on localhost (see debug-map-hook.js).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = process.env.PORT || '3901';
const url = `http://127.0.0.1:${port}/?area=bukit-bintang-imbi&debug-map=1`;
const out = path.join(ROOT, 'reports', 'osm_turn_lane_guidance_v1', 'screenshots');

console.log(`Open: ${url}`);
console.log('');
console.log('Browser console:');
console.log(`  __pintazMap.jumpTo({ center: [101.720574, 3.147586], zoom: 18 });`);
console.log('');
console.log(`Save captures under: ${out}`);
console.log('  01_toggle_off_same_eligible_road.png');
console.log('  02_toggle_on_same_eligible_road.png');
console.log('  03_close_up_turn_symbols_readable.png');
console.log('  04_unknown_or_ambiguous_road_no_guidance.png');

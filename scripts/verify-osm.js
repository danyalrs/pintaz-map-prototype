import fs from 'node:fs';
import { pbfPath, md5Path } from '../src/lib/paths.js';
import { parseMd5Sidecar, md5File, validatePbfChecksum } from '../src/lib/checksum.js';

async function main() {
  if (!fs.existsSync(pbfPath())) {
    console.error('PBF missing:', pbfPath());
    process.exit(1);
  }
  if (!fs.existsSync(md5Path())) {
    console.error('MD5 sidecar missing:', md5Path());
    process.exit(1);
  }
  const expected = parseMd5Sidecar(fs.readFileSync(md5Path(), 'utf8'));
  const check = await validatePbfChecksum(pbfPath(), expected);
  if (!check.valid) {
    console.error('Checksum mismatch');
    process.exit(1);
  }
  const stat = fs.statSync(pbfPath());
  console.log('OK', { sizeBytes: stat.size, md5: check.actual });
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

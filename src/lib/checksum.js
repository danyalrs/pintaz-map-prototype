import crypto from 'node:crypto';
import fs from 'node:fs';

/**
 * Parse Geofabrik-style MD5 sidecar (hex only or "hash  filename").
 */
export function parseMd5Sidecar(text) {
  const line = text.trim().split(/\r?\n/)[0] || '';
  const match = line.match(/([a-fA-F0-9]{32})/);
  if (!match) {
    throw new Error('Could not parse MD5 sidecar');
  }
  return match[1].toLowerCase();
}

export function md5File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export async function validatePbfChecksum(pbfFile, expectedMd5) {
  const actual = await md5File(pbfFile);
  return {
    valid: actual.toLowerCase() === expectedMd5.toLowerCase(),
    actual,
    expected: expectedMd5.toLowerCase(),
  };
}

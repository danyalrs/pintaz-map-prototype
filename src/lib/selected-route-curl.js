import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT_DIR } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * GET via curl.exe (Windows schannel / system trust store). Token only in child env.
 */
export function curlGetToFile(url, { token, outPath, headerPath, maxFilesizeBytes = null }) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(outPath);
    fs.mkdirSync(dir, { recursive: true });
    const args = [
      '--silent',
      '--show-error',
      '--location',
      '--max-time',
      '120',
      '--output',
      outPath,
      '--dump-header',
      headerPath,
      '--write-out',
      '%{http_code}',
      '--header',
      `Authorization: Bearer ${token}`,
      '--header',
      'Accept: application/json',
      ...(maxFilesizeBytes != null ? ['--max-filesize', String(maxFilesizeBytes)] : []),
      url,
    ];
    const child = spawn('curl.exe', args, {
      cwd: ROOT_DIR,
      env: { ...process.env },
      windowsHide: true,
    });
    let codeOut = '';
    child.stdout.on('data', (c) => {
      codeOut += c.toString();
    });
    child.stderr.on('data', (c) => {
      codeOut += c.toString();
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      const status = Number.parseInt(String(codeOut).trim().slice(-3), 10);
      if (!Number.isFinite(status)) {
        reject(new Error(`curl_status_unparseable:${exitCode}`));
        return;
      }
      resolve({ status, exitCode });
    });
  });
}

export function redactUrl(url) {
  return String(url).replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]');
}

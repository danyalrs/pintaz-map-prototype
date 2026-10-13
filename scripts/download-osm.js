import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { OSM } from '../src/config.js';
import { ensureDataDirs, pbfPath, md5Path, pbfPartPath, downloadRecordPath } from '../src/lib/paths.js';
import { parseMd5Sidecar, md5File, validatePbfChecksum } from '../src/lib/checksum.js';

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

function curlDownload(url, destPath, label) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const args = ['-fL', '--retry', '3', '--retry-delay', '2', '-o', destPath, url];
    const child = spawn('curl.exe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${label} curl failed (${code}): ${stderr.trim()}`));
        return;
      }
      const stat = fs.statSync(destPath);
      const elapsed = (Date.now() - start) / 1000;
      const speed = stat.size / Math.max(elapsed, 0.001);
      console.log(
        `[${label}] complete: ${formatBytes(stat.size)} in ${elapsed.toFixed(1)}s (${formatBytes(speed)}/s)`
      );
      resolve({ downloaded: stat.size, total: stat.size, elapsedSeconds: elapsed });
    });
  });
}

async function fetchWithProgress(url, destPart, label) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length') || 0);
    const start = Date.now();
    let downloaded = 0;
    let lastLog = start;
    const body = res.body;
    if (!body) throw new Error('Empty response body');
    const reader = body.getReader();
    const out = fs.createWriteStream(destPart);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      downloaded += value.length;
      out.write(Buffer.from(value));
      const now = Date.now();
      if (now - lastLog >= 2000) {
        const elapsed = (now - start) / 1000;
        const speed = downloaded / Math.max(elapsed, 0.001);
        const pct = total > 0 ? ((downloaded / total) * 100).toFixed(1) : '?';
        console.log(
          `[${label}] ${formatBytes(downloaded)} / ${total ? formatBytes(total) : '?'} (${pct}%) @ ${formatBytes(speed)}/s, ${elapsed.toFixed(0)}s`
        );
        lastLog = now;
      }
    }
    await new Promise((resolve, reject) => {
      out.end(() => resolve());
      out.on('error', reject);
    });
    const elapsed = (Date.now() - start) / 1000;
    console.log(`[${label}] complete: ${formatBytes(downloaded)} in ${elapsed.toFixed(1)}s`);
    return { downloaded, total, elapsedSeconds: elapsed };
  } catch (err) {
    console.warn(`[${label}] fetch failed (${err.message}); falling back to curl.exe`);
    return curlDownload(url, destPart, label);
  }
}

async function downloadMd5() {
  const tmp = `${md5Path()}.part`;
  try {
    const res = await fetch(OSM.md5Url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    fs.writeFileSync(md5Path(), text, 'utf8');
    return parseMd5Sidecar(text);
  } catch {
    await curlDownload(OSM.md5Url, tmp, 'MD5');
    fs.renameSync(tmp, md5Path());
    const text = fs.readFileSync(md5Path(), 'utf8');
    return parseMd5Sidecar(text);
  }
}

async function main() {
  ensureDataDirs();
  const finalPath = pbfPath();
  const partPath = pbfPartPath();

  let expectedMd5 = null;
  if (fs.existsSync(md5Path())) {
    expectedMd5 = parseMd5Sidecar(fs.readFileSync(md5Path(), 'utf8'));
  }

  if (fs.existsSync(finalPath) && expectedMd5) {
    const check = await validatePbfChecksum(finalPath, expectedMd5);
    if (check.valid) {
      console.log('Valid PBF already present; skipping download.');
      writeRecord({ skipped: true, validation: check });
      return;
    }
    console.warn('Existing PBF failed checksum; re-downloading.');
  }

  expectedMd5 = await downloadMd5();
  console.log('Expected MD5:', expectedMd5);

  if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
  await fetchWithProgress(OSM.pbfUrl, partPath, 'PBF');
  fs.renameSync(partPath, finalPath);

  const check = await validatePbfChecksum(finalPath, expectedMd5);
  if (!check.valid) {
    console.error('Checksum validation FAILED');
    console.error(' expected:', check.expected);
    console.error(' actual:  ', check.actual);
    process.exit(1);
  }

  const stat = fs.statSync(finalPath);
  writeRecord({
    skipped: false,
    sourceUrl: OSM.pbfUrl,
    md5Url: OSM.md5Url,
    downloadedAt: new Date().toISOString(),
    sizeBytes: stat.size,
    md5: check.actual,
    validation: { valid: true },
  });
  console.log('Checksum OK. Record written.');
}

function writeRecord(extra) {
  const record = {
    ...extra,
    file: path.basename(pbfPath()),
  };
  fs.writeFileSync(downloadRecordPath(), JSON.stringify(record, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

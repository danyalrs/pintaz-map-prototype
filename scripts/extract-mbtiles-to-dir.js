import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';

/**
 * Expand MBTiles into z/x/y.pbf tree for the existing HTTP tile handler.
 */
export async function extractMbtilesToDirectory(mbtilesFile, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const SQL = await initSqlJs();
  const fileBuffer = fs.readFileSync(mbtilesFile);
  const db = new SQL.Database(fileBuffer);
  const result = db.exec('SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles');
  if (!result.length) {
    db.close();
    throw new Error('MBTiles contains no tiles');
  }
  const columns = result[0];
  let written = 0;
  for (const row of columns.values) {
    const z = row[0];
    const x = row[1];
    const tileRow = row[2];
    const data = row[3];
    const y = (1 << z) - 1 - tileRow;
    const dir = path.join(outputDir, String(z), String(x));
    fs.mkdirSync(dir, { recursive: true });
    const bytes = data instanceof Uint8Array ? Buffer.from(data) : Buffer.from(data);
    fs.writeFileSync(path.join(dir, `${y}.pbf`), bytes);
    written += 1;
  }
  db.close();
  console.log(`Extracted ${written} tiles from MBTiles to ${outputDir}`);
  return written;
}

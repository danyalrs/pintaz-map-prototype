import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const styles = JSON.parse(fs.readFileSync(path.join(root, 'config', 'road-styles.json'), 'utf8'));

test('highway classes styled', () => {
  assert.ok(styles.classes.motorway);
  assert.ok(styles.classes.primary);
  assert.ok(styles.classes._fallback);
});

test('unknown highway uses fallback entry', () => {
  assert.ok(styles.classes._fallback.color);
});

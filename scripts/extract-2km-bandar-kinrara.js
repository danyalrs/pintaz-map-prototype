#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'extract-2km-local-area.js');
const child = spawn(process.execPath, [script, 'bandar-kinrara'], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));

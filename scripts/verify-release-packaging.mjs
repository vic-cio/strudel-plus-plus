#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REQUIRED_MODULES = [
  '@strudel/core',
  '@strudel/webaudio',
  '@strudel/transpiler',
  '@strudel/tonal',
  '@strudel/mini',
  '@strudel/midi',
  '@strudel/osc',
  '@strudel/mondo',
  '@strudel/draw',
  '@strudel/hydra',
  '@strudel/motion',
  '@strudel/soundfonts',
  '@strudel/xen',
  '@strudel/codemirror',
];

const appPath = resolve(process.argv[2] || 'app/release/mac-arm64/strudel++.app');
const asarPath = join(appPath, 'Contents', 'Resources', 'app.asar.unpacked');
const nodeModulesPath = join(asarPath, 'node_modules');

let errors = 0;
function fail(msg) {
  console.error(`[release-verify] FAIL: ${msg}`);
  errors++;
}

if (!existsSync(appPath)) {
  fail(`App bundle not found at ${appPath}`);
  process.exit(1);
}

for (const mod of REQUIRED_MODULES) {
  const modPath = join(nodeModulesPath, mod);
  if (!existsSync(modPath)) {
    fail(`Required module missing in package: ${mod}`);
  } else {
    console.log(`[release-verify] OK: ${mod}`);
  }
}

const externalStrudelPath = resolve('app/.external/strudel');
if (!existsSync(externalStrudelPath)) {
  fail('Pinned upstream modules missing: app/.external/strudel');
} else {
  console.log('[release-verify] OK: pinned upstream modules present');
}

if (errors > 0) {
  console.error(`[release-verify] ${errors} failure(s)`);
  process.exit(1);
}
console.log('[release-verify] All packaged modules present');

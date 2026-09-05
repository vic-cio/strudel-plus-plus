#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const identity = process.env.DEVELOPER_ID_APP_IDENTITY;
if (!identity) {
  console.error('Missing DEVELOPER_ID_APP_IDENTITY for release build');
  process.exit(1);
}

const outputPath = resolve('release/electron-builder.release.generated.yml');
const config = `mac:
  identity: "${identity}"
  notarize: true
  hardenedRuntime: true
  target:
    - dmg
    - zip
`;
writeFileSync(outputPath, config, 'utf8');
console.log(`Release config generated at: ${outputPath}`);

#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const identity = process.env.DEVELOPER_ID_APP_IDENTITY;
if (!identity) {
  console.error('Missing DEVELOPER_ID_APP_IDENTITY for release build');
  process.exit(1);
}

const templatePath = resolve('release/electron-builder.release.yml');
let template = readFileSync(templatePath, 'utf8');
const output = template.replace('DEVELOPER_ID_APP_IDENTITY_PLACEHOLDER', identity);
writeFileSync(templatePath, output, 'utf8');
console.log(`Release config generated with identity: ${identity}`);

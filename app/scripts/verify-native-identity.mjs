import { existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';

const PRODUCT_NAME = 'strudel++';
const APPLICATION_IDENTIFIER = 'com.victor.strudel-desktop';
const defaultAppPath = resolve(process.cwd(), 'release/mac-arm64/strudel++.app');
const appArgument = process.argv.slice(2).find((argument) => argument !== '--');
const appPath = resolve(appArgument ?? defaultAppPath);

function fail(message) {
  throw new Error(`[native-identity] ${message}`);
}

function requireString(record, key) {
  const value = record[key];
  if (typeof value !== 'string') {
    fail(`Info.plist ${key} must be a string`);
  }
  return value;
}

function requireRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function parseInfoPlist(plistPath) {
  try {
    const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', plistPath], { encoding: 'utf8' });
    return requireRecord(JSON.parse(json), 'Info.plist');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('[native-identity]')) {
      throw error;
    }
    fail(`could not parse ${plistPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseSipsInfo(iconPath) {
  const output = execFileSync('sips', ['-g', 'format', '-g', 'pixelWidth', '-g', 'pixelHeight', iconPath], {
    encoding: 'utf8',
  });
  const values = new Map(
    output
      .split('\n')
      .map((line) => line.trim().split(': '))
      .filter(([key, value]) => key && value),
  );
  const format = values.get('format');
  const width = Number(values.get('pixelWidth'));
  const height = Number(values.get('pixelHeight'));
  if (format !== 'icns' || width !== 1024 || height !== 1024) {
    fail(`icon.icns must be a 1024x1024 ICNS (got ${format ?? 'unknown'} ${width}x${height})`);
  }
}

if (!existsSync(appPath)) {
  fail(`bundle does not exist: ${appPath}`);
}
if (basename(appPath) !== `${PRODUCT_NAME}.app`) {
  fail(`bundle must be named ${PRODUCT_NAME}.app (got ${basename(appPath)})`);
}

const contentsPath = join(appPath, 'Contents');
const infoPlistPath = join(contentsPath, 'Info.plist');
const plist = parseInfoPlist(infoPlistPath);

for (const key of ['CFBundleDisplayName', 'CFBundleName', 'CFBundleExecutable']) {
  if (requireString(plist, key) !== PRODUCT_NAME) {
    fail(`Info.plist ${key} must be ${PRODUCT_NAME}`);
  }
}
if (requireString(plist, 'CFBundleIdentifier') !== APPLICATION_IDENTIFIER) {
  fail(`Info.plist CFBundleIdentifier must remain ${APPLICATION_IDENTIFIER}`);
}

const iconFile = requireString(plist, 'CFBundleIconFile');
if (iconFile !== 'icon.icns') {
  fail(`Info.plist CFBundleIconFile must be icon.icns (got ${iconFile})`);
}
const iconPath = join(contentsPath, 'Resources', iconFile);
if (!existsSync(iconPath)) {
  fail(`declared icon does not exist: ${iconPath}`);
}
parseSipsInfo(iconPath);

const executablePath = join(contentsPath, 'MacOS', requireString(plist, 'CFBundleExecutable'));
if (!existsSync(executablePath)) {
  fail(`declared executable does not exist: ${executablePath}`);
}
if (!existsSync(join(contentsPath, 'Resources', 'app.asar'))) {
  fail('packaged renderer is missing Resources/app.asar');
}

// node-pty 1.1.0 ships its macOS spawn helper without the executable bit, and
// a helper that cannot be exec'd makes every harness start fail with a raw
// "posix_spawnp failed." (see app/src/main/ptyHelper.ts).
const prebuildsPath = join(contentsPath, 'Resources', 'app.asar.unpacked', 'node_modules', 'node-pty', 'prebuilds');
const darwinHelpers = existsSync(prebuildsPath)
  ? readdirSync(prebuildsPath)
      .filter((name) => name.startsWith('darwin-'))
      .map((name) => join(prebuildsPath, name, 'spawn-helper'))
      .filter((helper) => existsSync(helper))
  : [];
if (darwinHelpers.length === 0) {
  fail('packaged node-pty is missing prebuilds/darwin-*/spawn-helper');
}
for (const helper of darwinHelpers) {
  if ((statSync(helper).mode & 0o111) === 0) {
    fail(`packaged node-pty helper is not executable: ${helper}`);
  }
}

console.log(`native identity ok: ${appPath}`);

import desktopPackage from '../package.json';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PRODUCT_NAME = 'strudel++';
const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));
const CONFIGURED_ICON_PATH = resolve(APP_ROOT, desktopPackage.build.icon);
const SOURCE_ICON_PATH = resolve(
  dirname(CONFIGURED_ICON_PATH),
  `${basename(CONFIGURED_ICON_PATH, extname(CONFIGURED_ICON_PATH))}.svg`,
);

describe('native app identity', () => {
  it('keeps the Electron build identity and verifies its packaged output', () => {
    expect(desktopPackage.build.productName).toBe(PRODUCT_NAME);
    expect(desktopPackage.build.icon).toBe('build/icon.png');
    expect(desktopPackage.build.mac.executableName).toBe(PRODUCT_NAME);
    expect(desktopPackage.build.mac.extendInfo).toEqual({
      CFBundleDisplayName: PRODUCT_NAME,
      CFBundleName: PRODUCT_NAME,
    });
    expect(desktopPackage.scripts['verify:identity']).toBe('node scripts/verify-native-identity.mjs');
    expect(desktopPackage.scripts.build.split(' && ').at(-1)).toBe('npm run verify:identity');
  });

  it('keeps the checked-in SVG source and packaged PNG as the same rendered asset', () => {
    expect(existsSync(SOURCE_ICON_PATH)).toBe(true);

    const temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'strudelpp-icon-'));
    const renderedIconPath = resolve(temporaryDirectory, basename(CONFIGURED_ICON_PATH));

    try {
      execFileSync('sips', ['-s', 'format', 'png', SOURCE_ICON_PATH, '--out', renderedIconPath], {
        stdio: 'pipe',
      });
      expect(readFileSync(renderedIconPath)).toEqual(readFileSync(CONFIGURED_ICON_PATH));
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('ships a valid source icon asset', () => {
    const electronIcon = readFileSync(CONFIGURED_ICON_PATH);
    expect(electronIcon.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(electronIcon.readUInt32BE(16)).toBe(1024);
    expect(electronIcon.readUInt32BE(20)).toBe(1024);
  });

  it('validates the fresh macOS bundle when one has been built', () => {
    const bundle = resolve(process.cwd(), 'release/mac-arm64/strudel++.app');
    if (!existsSync(bundle)) {
      return;
    }
    expect(() =>
      execFileSync(process.execPath, ['scripts/verify-native-identity.mjs', bundle], {
        cwd: process.cwd(),
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});

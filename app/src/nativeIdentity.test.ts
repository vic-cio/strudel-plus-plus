import desktopPackage from '../package.json';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PRODUCT_NAME = 'strudel++';

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

  it('keeps the checked-in icon source pixel-aligned with the product mark', () => {
    const source = readFileSync(new URL('../build/icon.svg', import.meta.url), 'utf8');
    const GRID = 4;

    const svgOpenTag = source.match(/<svg\b[^>]*>/)?.[0];
    if (!svgOpenTag) {
      throw new Error('icon.svg is missing an <svg> root element');
    }
    expect(svgOpenTag).toMatch(/shape-rendering="crispEdges"/);

    const title = source.match(/<title>([^<]*)<\/title>/)?.[1];
    expect(title).toBe(PRODUCT_NAME);

    const viewBox = svgOpenTag
      .match(/viewBox="([\d.\s]+)"/)?.[1]
      ?.split(/\s+/)
      .map(Number);
    if (!viewBox) {
      throw new Error('icon.svg is missing a viewBox');
    }
    const [, , gridWidth, gridHeight] = viewBox;
    if (gridWidth === undefined || gridHeight === undefined) {
      throw new Error('icon.svg viewBox is missing width/height values');
    }
    expect(gridWidth % GRID).toBe(0);
    expect(gridHeight % GRID).toBe(0);

    const shapeCoordinates: number[] = [];
    for (const rectTag of source.matchAll(/<rect\b[^>]*\/?>/g)) {
      for (const attr of ['x', 'y', 'width', 'height']) {
        const value = rectTag[0].match(new RegExp(`${attr}="(-?[\\d.]+)"`))?.[1];
        if (value !== undefined) {
          shapeCoordinates.push(Number(value));
        }
      }
    }
    for (const pathTag of source.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)) {
      const pathData = pathTag[1];
      if (pathData === undefined) {
        continue;
      }
      for (const numberMatch of pathData.matchAll(/-?\d+(?:\.\d+)?/g)) {
        shapeCoordinates.push(Number(numberMatch[0]));
      }
    }

    expect(shapeCoordinates.length).toBeGreaterThan(0);
    for (const coordinate of shapeCoordinates) {
      expect(Math.abs(coordinate % GRID)).toBe(0);
    }
  });

  it('ships a valid source icon asset', () => {
    const electronIcon = readFileSync(new URL('../build/icon.png', import.meta.url));
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

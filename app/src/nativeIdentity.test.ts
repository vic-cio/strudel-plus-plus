import desktopPackage from '../package.json';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const PRODUCT_NAME = 'strudel++';
const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));
const CONFIGURED_ICON_PATH = resolve(APP_ROOT, desktopPackage.build.icon);
const SOURCE_ICON_PATH = resolve(
  dirname(CONFIGURED_ICON_PATH),
  `${basename(CONFIGURED_ICON_PATH, extname(CONFIGURED_ICON_PATH))}.svg`,
);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

type DecodedPng = {
  width: number;
  height: number;
  pixels: Buffer;
};

type PngHeader = {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  compressionMethod: number;
  filterMethod: number;
  interlaceMethod: number;
};

const byteAt = (buffer: Buffer, index: number): number => {
  const byte = buffer[index];
  if (byte === undefined) {
    throw new Error(`PNG data is truncated at byte ${index}`);
  }
  return byte;
};

const paethPredictor = (left: number, above: number, upperLeft: number): number => {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);

  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  if (aboveDistance <= upperLeftDistance) {
    return above;
  }
  return upperLeft;
};

const decodePng = (png: Buffer): DecodedPng => {
  if (!png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('Expected a PNG image');
  }

  let offset = PNG_SIGNATURE.length;
  let header: PngHeader | undefined;
  const imageData: Buffer[] = [];

  while (offset < png.length) {
    if (offset + 12 > png.length) {
      throw new Error('PNG chunk header is truncated');
    }

    const chunkLength = png.readUInt32BE(offset);
    const chunkType = png.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > png.length) {
      throw new Error(`PNG ${chunkType} chunk is truncated`);
    }

    const chunkData = png.subarray(dataStart, dataEnd);
    if (chunkType === 'IHDR') {
      if (header !== undefined || chunkData.length !== 13) {
        throw new Error('PNG must contain one valid IHDR chunk');
      }
      header = {
        width: chunkData.readUInt32BE(0),
        height: chunkData.readUInt32BE(4),
        bitDepth: chunkData.readUInt8(8),
        colorType: chunkData.readUInt8(9),
        compressionMethod: chunkData.readUInt8(10),
        filterMethod: chunkData.readUInt8(11),
        interlaceMethod: chunkData.readUInt8(12),
      };
    } else if (chunkType === 'IDAT') {
      imageData.push(chunkData);
    } else if (chunkType === 'IEND') {
      break;
    }

    offset = chunkEnd;
  }

  if (header === undefined || imageData.length === 0) {
    throw new Error('PNG is missing image data');
  }
  if (
    header.width === 0 ||
    header.height === 0 ||
    header.bitDepth !== 8 ||
    header.colorType !== 6 ||
    header.compressionMethod !== 0 ||
    header.filterMethod !== 0 ||
    header.interlaceMethod !== 0
  ) {
    throw new Error('PNG must be a non-interlaced 8-bit RGBA image');
  }

  const bytesPerPixel = 4;
  const rowLength = header.width * bytesPerPixel;
  const scanlines = inflateSync(Buffer.concat(imageData));
  const expectedScanlineLength = header.height * (rowLength + 1);
  if (scanlines.length !== expectedScanlineLength) {
    throw new Error('PNG scanline data has an unexpected length');
  }

  const pixels = Buffer.alloc(header.width * header.height * bytesPerPixel);
  for (let y = 0; y < header.height; y += 1) {
    const scanlineStart = y * (rowLength + 1);
    const pixelStart = y * rowLength;
    const filter = byteAt(scanlines, scanlineStart);

    for (let x = 0; x < rowLength; x += 1) {
      const raw = byteAt(scanlines, scanlineStart + x + 1);
      const left = x >= bytesPerPixel ? byteAt(pixels, pixelStart + x - bytesPerPixel) : 0;
      const above = y > 0 ? byteAt(pixels, pixelStart + x - rowLength) : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? byteAt(pixels, pixelStart + x - rowLength - bytesPerPixel) : 0;

      let predictor: number;
      switch (filter) {
        case 0:
          predictor = 0;
          break;
        case 1:
          predictor = left;
          break;
        case 2:
          predictor = above;
          break;
        case 3:
          predictor = Math.floor((left + above) / 2);
          break;
        case 4:
          predictor = paethPredictor(left, above, upperLeft);
          break;
        default:
          throw new Error(`PNG uses unsupported filter ${filter}`);
      }

      pixels[pixelStart + x] = (raw + predictor) & 0xff;
    }
  }

  return { width: header.width, height: header.height, pixels };
};

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
      const renderedIcon = decodePng(readFileSync(renderedIconPath));
      const configuredIcon = decodePng(readFileSync(CONFIGURED_ICON_PATH));
      expect(renderedIcon.width).toBe(configuredIcon.width);
      expect(renderedIcon.height).toBe(configuredIcon.height);
      expect(renderedIcon.pixels.equals(configuredIcon.pixels)).toBe(true);
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

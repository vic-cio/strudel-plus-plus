import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureExecutable, findPtyHelper, unpackedResourcePath } from './ptyHelper';

const workRoots: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'strudel-ptyhelper-'));
  workRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of workRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('unpackedResourcePath', () => {
  it('rewrites an asar path to the unpacked copy', () => {
    // node-pty resolves itself inside the asar, but the helper it spawns has
    // to be the real file next to the unpacked native module.
    expect(unpackedResourcePath('/App/strudel++.app/Contents/Resources/app.asar/node_modules/node-pty')).toBe(
      '/App/strudel++.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty',
    );
  });

  it('rewrites a node_modules.asar path too', () => {
    expect(unpackedResourcePath('/app/node_modules.asar/node-pty')).toBe('/app/node_modules.asar.unpacked/node-pty');
  });

  it('leaves plain paths alone', () => {
    expect(unpackedResourcePath('/app/node_modules/node-pty')).toBe('/app/node_modules/node-pty');
  });
});

describe('findPtyHelper', () => {
  it('prefers the build/Release helper, as node-pty loads its module', () => {
    const root = scratch();
    const released = join(root, 'build/Release');
    mkdirSync(released, { recursive: true });
    writeFileSync(join(released, 'spawn-helper'), '');
    mkdirSync(join(root, 'prebuilds/darwin-arm64'), { recursive: true });
    writeFileSync(join(root, 'prebuilds/darwin-arm64/spawn-helper'), '');

    expect(findPtyHelper(root, 'darwin', 'arm64')).toBe(join(released, 'spawn-helper'));
  });

  it('falls back to the prebuilds helper for the running platform', () => {
    const root = scratch();
    const prebuilt = join(root, 'prebuilds/darwin-arm64');
    mkdirSync(prebuilt, { recursive: true });
    writeFileSync(join(prebuilt, 'spawn-helper'), '');

    expect(findPtyHelper(root, 'darwin', 'arm64')).toBe(join(prebuilt, 'spawn-helper'));
    expect(findPtyHelper(root, 'darwin', 'x64')).toBeUndefined();
  });

  it('rewrites the packaged helper to its unpacked location', () => {
    const root = scratch();
    const prebuilt = join(root, 'app.asar.unpacked/node-pty/prebuilds/darwin-arm64');
    mkdirSync(prebuilt, { recursive: true });
    writeFileSync(join(prebuilt, 'spawn-helper'), '');

    // The root comes from node-pty inside the asar; the helper must be looked
    // for (and repaired) in the unpacked copy beside it.
    expect(findPtyHelper(join(root, 'app.asar/node-pty'), 'darwin', 'arm64')).toBe(join(prebuilt, 'spawn-helper'));
  });
});

describe('ensureExecutable', () => {
  it('gives the helper back its owner execute bit', () => {
    const helper = join(scratch(), 'spawn-helper');
    writeFileSync(helper, '');
    chmodSync(helper, 0o644); // What the node-pty 1.1.0 tarball ships.

    expect(ensureExecutable(helper)).toBe(true);
    expect(statSync(helper).mode & 0o755).toBe(0o755);
  });

  it('leaves an executable helper alone', () => {
    const helper = join(scratch(), 'spawn-helper');
    writeFileSync(helper, '');
    chmodSync(helper, 0o754);

    expect(ensureExecutable(helper)).toBe(true);
    expect(statSync(helper).mode & 0o777).toBe(0o754);
  });

  it('reports a missing helper instead of raising', () => {
    expect(ensureExecutable(join(scratch(), 'absent'))).toBe(false);
  });

  it('reports a chmod that could not be applied', () => {
    const helper = join(scratch(), 'spawn-helper');
    writeFileSync(helper, '');
    expect(
      ensureExecutable(
        helper,
        () => ({ mode: 0o644 }),
        () => {
          throw new Error('EROFS');
        },
      ),
    ).toBe(false);
  });
});

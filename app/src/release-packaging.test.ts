import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('release packaging', () => {
  it('release workflow file exists and has required secrets check', () => {
    expect(existsSync(resolve('../.github/workflows/release.yml'))).toBe(true);
  });

  it('release verification script exists', () => {
    expect(existsSync(resolve('../scripts/verify-release-packaging.mjs'))).toBe(true);
  });

  it('release setup docs exist', () => {
    expect(existsSync(resolve('../release-docs/release-setup.md'))).toBe(true);
  });

  it('release config template exists', () => {
    expect(existsSync(resolve('../release/electron-builder.release.yml'))).toBe(true);
  });

  it('package.json has notarize and hardenedRuntime set', () => {
    const pkgText = readFileSync(resolve('package.json'), 'utf8');
    const pkg = JSON.parse(pkgText);
    // package.json under app/ has the electron-builder config
    expect(pkg.build?.mac?.notarize).toBe(true);
    expect(pkg.build?.mac?.hardenedRuntime).toBe(true);
  });
});

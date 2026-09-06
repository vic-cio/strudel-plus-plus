import { beforeEach, describe, expect, it } from 'vitest';
import { createSettingsStore } from './settingsStore';
import { validateSettings, DEFAULT_SETTINGS, SETTINGS_VERSION } from './settings';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('settings store', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'settings-'));
  });

  it('loads and saves validated settings', async () => {
    const store = createSettingsStore(dir);
    await store.save({
      version: SETTINGS_VERSION,
      beatSwitchTiming: 'manual',
      closeBehavior: 'auto-save',
      recordConfig: { enabled: true, mode: 'mp4' },
    });
    const loaded = await store.load();
    expect(loaded.beatSwitchTiming).toBe('manual');
    expect(loaded.closeBehavior).toBe('auto-save');
    expect(loaded.recordConfig?.mode).toBe('mp4');
  });

  it('falls back to defaults for missing file', async () => {
    const store = createSettingsStore(dir);
    const loaded = await store.load();
    expect(loaded.version).toBe(SETTINGS_VERSION);
    expect(loaded.beatSwitchTiming).toBe('next-bar');
  });
});

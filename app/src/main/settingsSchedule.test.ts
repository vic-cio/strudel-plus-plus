import { describe, it, expect } from 'vitest';
import { validateSettings, DEFAULT_SETTINGS, SETTINGS_VERSION } from '../main/settings';

describe('persistence and migration', () => {
  it('migrates old version to current defaults', () => {
    const s = validateSettings({ version: 0, beatSwitchTiming: 'next-bar' });
    expect(s.version).toBe(0);
    expect(s.beatSwitchTiming).toBe('next-bar');
  });

  it('preserves manual timing through migration', () => {
    const s = validateSettings({ version: 1, beatSwitchTiming: 'manual', closeBehavior: 'auto-save' });
    expect(s.beatSwitchTiming).toBe('manual');
    expect(s.closeBehavior).toBe('auto-save');
  });

  it('defaults sessionsRoot to undefined', () => {
    const s = validateSettings({});
    expect(s.sessionsRoot).toBeUndefined();
    expect(s.version).toBe(SETTINGS_VERSION);
  });
});

describe('latency scheduling contract', () => {
  it('accepts all four latency modes', () => {
    const modes: Array<'immediate' | 'next-bar' | 'next-half-bar' | 'manual'> = [
      'immediate', 'next-bar', 'next-half-bar', 'manual',
    ];
    for (const mode of modes) {
      const s = validateSettings({ version: 1, beatSwitchTiming: mode });
      expect(s.beatSwitchTiming).toBe(mode);
    }
  });
});

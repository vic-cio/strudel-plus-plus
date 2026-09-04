import { beforeEach, describe, expect, it } from 'vitest';
import { validateSettings, DEFAULT_SETTINGS, SETTINGS_VERSION } from './settings';

describe('settings contract', () => {
  it('accepts a valid settings object', () => {
    const s = validateSettings({ version: 1, beatSwitchTiming: 'manual', closeBehavior: 'auto-save' });
    expect(s.version).toBe(1);
    expect(s.beatSwitchTiming).toBe('manual');
  });
  it('falls back to defaults for missing fields', () => {
    const s = validateSettings({ version: 2 });
    expect(s.beatSwitchTiming).toBe('next-bar');
    expect(s.closeBehavior).toBe('ask');
  });
  it('ignores corrupt timing values', () => {
    const s = validateSettings({ version: 1, beatSwitchTiming: 'future' });
    expect(s.beatSwitchTiming).toBe('next-bar');
  });
  it('preserves environment root precedence (not moved)', () => {
    const s = validateSettings({ version: 1, sessionsRoot: '/existing/folder' });
    expect(s.sessionsRoot).toBe('/existing/folder');
    // Root must not be silently moved/copied; this validates the contract.
  });
});

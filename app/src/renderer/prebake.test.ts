import { beforeEach, describe, expect, it, vi } from 'vitest';

const sounds = new Map<string, { onTrigger: (...args: unknown[]) => unknown; data: unknown }>();

vi.mock('@strudel/core', () => ({
  Pattern: { prototype: {} },
  noteToMidi: vi.fn(),
  valueToMidi: vi.fn(),
}));

vi.mock('@strudel/webaudio', () => ({
  aliasBank: vi.fn(),
  registerSynthSounds: vi.fn(),
  registerZZFXSounds: vi.fn(),
  samples: vi.fn(),
  getSound: (name: string) => sounds.get(name),
  registerSound: (name: string, onTrigger: (...args: unknown[]) => unknown, data: unknown) => {
    sounds.set(name, { onTrigger, data });
  },
}));

vi.mock('@strudel/soundfonts/gm.mjs', () => ({
  default: { gm_pad_halo: ['0940_Chaos_sf2_file'] },
}));

import { nameSoundfontLoadErrors } from './prebake.mjs';

describe('nameSoundfontLoadErrors', () => {
  beforeEach(() => {
    sounds.clear();
  });

  it('leaves a successful trigger untouched', async () => {
    sounds.set('gm_pad_halo', { onTrigger: vi.fn().mockResolvedValue('handle'), data: { type: 'soundfont' } });
    nameSoundfontLoadErrors();
    await expect(sounds.get('gm_pad_halo')!.onTrigger()).resolves.toBe('handle');
  });

  it('names the failing instrument when its trigger throws', async () => {
    sounds.set('gm_pad_halo', {
      onTrigger: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
      data: { type: 'soundfont' },
    });
    nameSoundfontLoadErrors();
    await expect(sounds.get('gm_pad_halo')!.onTrigger()).rejects.toThrow(
      'Could not load soundfont "gm_pad_halo": Failed to fetch',
    );
  });

  it('skips instruments that were never registered', () => {
    expect(() => nameSoundfontLoadErrors()).not.toThrow();
  });
});

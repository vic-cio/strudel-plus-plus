import { describe, expect, it, vi } from 'vitest';

vi.mock('@strudel/webaudio', () => ({
  getAudioContext: () => ({ currentTime: 0 }),
  getSuperdoughAudioController: () => undefined,
}));

import { createGainAudioAdapter } from './gainAudio';

function fakeParameter(initial = 1) {
  return {
    value: initial,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(function (this: { value: number }, value: number) {
      this.value = value;
    }),
  };
}

describe('live gain audio adapter', () => {
  it('updates the live AudioParam and reports the effective value', () => {
    const parameter = fakeParameter();
    const adapter = createGainAudioAdapter({
      resolveParameter: () => parameter,
      now: () => 12.5,
    });

    expect(adapter.set(0.42)).toEqual({ kind: 'applied', value: 0.42 });
    expect(parameter.cancelScheduledValues).toHaveBeenCalledWith(12.5);
    expect(parameter.setValueAtTime).toHaveBeenCalledWith(0.42, 12.5);
    expect(adapter.read()).toEqual({ kind: 'applied', value: 0.42 });
  });

  it('rejects invalid values without touching audio', () => {
    const parameter = fakeParameter();
    const adapter = createGainAudioAdapter({ resolveParameter: () => parameter, now: () => 0 });

    expect(adapter.set(Number.NaN)).toEqual({ kind: 'invalid', message: 'gain must be a finite number' });
    expect(adapter.set(1.1)).toEqual({ kind: 'invalid', message: 'gain must be between 0 and 1' });
    expect(parameter.setValueAtTime).not.toHaveBeenCalled();
  });

  it('returns a visible failure result when the live output is unavailable', () => {
    const adapter = createGainAudioAdapter({ resolveParameter: () => undefined, now: () => 0 });

    expect(adapter.set(0.5)).toEqual({ kind: 'unavailable', message: 'live audio output is not ready' });
    expect(adapter.read()).toEqual({ kind: 'unavailable', message: 'live audio output is not ready' });
  });
});

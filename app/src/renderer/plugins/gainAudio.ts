import { validateControlValue, type NumericControl } from './controlModel';

export const GAIN_CONTROL: NumericControl = {
  kind: 'number',
  id: 'gain',
  label: 'gain',
  scope: { kind: 'session' },
  min: 0,
  max: 1,
  step: 0.01,
  defaultValue: 1,
};

export type GainParameter = {
  value: number;
  setValueAtTime(value: number, startTime: number): unknown;
  cancelScheduledValues(startTime: number): unknown;
};

export type GainAudioResult =
  | { kind: 'applied'; value: number }
  | { kind: 'unavailable'; message: string }
  | { kind: 'invalid'; message: string };

export type GainAudioDeps = {
  resolveParameter: () => GainParameter | undefined;
  now: () => number;
};

/**
 * Narrow adapter around the current Strudel output graph. Keeping the engine
 * lookup here means the plugin never pretends a UI value was applied when the
 * output node is unavailable or has been reset by an offline render.
 */
export type GainAudioAdapter = ReturnType<typeof createGainAudioAdapter>;

export function createGainAudioAdapter(deps: GainAudioDeps) {
  const read = (): GainAudioResult => {
    const parameter = deps.resolveParameter();
    if (!parameter || !Number.isFinite(parameter.value)) {
      return { kind: 'unavailable', message: 'live audio output is not ready' };
    }
    return { kind: 'applied', value: parameter.value };
  };

  const set = (value: unknown): GainAudioResult => {
    const validated = validateControlValue(GAIN_CONTROL, value);
    if (validated.kind === 'invalid') {
      return validated;
    }
    const parameter = deps.resolveParameter();
    if (!parameter) {
      return { kind: 'unavailable', message: 'live audio output is not ready' };
    }
    try {
      const now = deps.now();
      parameter.cancelScheduledValues(now);
      parameter.setValueAtTime(validated.value, now);
      return read();
    } catch {
      return { kind: 'unavailable', message: 'live audio output rejected the gain update' };
    }
  };

  return { read, set };
}

/** Load the engine only when the gain device is actually mounted. */
export async function createBrowserGainAudioAdapter(): Promise<GainAudioAdapter> {
  const { getAudioContext, getSuperdoughAudioController } = await import('@strudel/webaudio');
  return createGainAudioAdapter({
    resolveParameter: () => {
      try {
        return getSuperdoughAudioController()?.output?.destinationGain?.gain;
      } catch {
        return undefined;
      }
    },
    now: () => getAudioContext().currentTime,
  });
}

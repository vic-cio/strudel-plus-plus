import { useEffect, useRef, useState } from 'react';
import { reportError } from '../reportErrors';
import { registerPlugin } from './registry';
import { createBrowserGainAudioAdapter, GAIN_CONTROL, type GainAudioAdapter, type GainAudioResult } from './gainAudio';
import type { PluginProps } from './registry';

export type GainPluginState = { value: number };

function readStoredValue(state: unknown): number | undefined {
  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    return undefined;
  }
  if (!('value' in state)) {
    return undefined;
  }
  const value = state.value;
  return typeof value === 'number' ? value : undefined;
}

function messageFor(result: Exclude<GainAudioResult, { kind: 'applied' }>): string {
  return result.message;
}

export function GainControl({ state, onState, playing }: PluginProps) {
  const adapterRef = useRef<GainAudioAdapter | undefined>(undefined);
  const storedValue = readStoredValue(state);
  const [value, setValue] = useState(storedValue ?? GAIN_CONTROL.defaultValue);
  const [error, setError] = useState<string>();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    setReady(false);
    void createBrowserGainAudioAdapter()
      .then((adapter) => {
        if (!active) {
          return;
        }
        adapterRef.current = adapter;
        setReady(true);
        const result = storedValue === undefined ? adapter.read() : adapter.set(storedValue);
        if (result.kind === 'applied') {
          setValue(result.value);
          setError(undefined);
        } else {
          setError(messageFor(result));
        }
      })
      .catch(() => {
        if (active) {
          setError('live audio engine could not be loaded');
        }
      });
    return () => {
      active = false;
    };
  }, [playing, storedValue]);

  const update = (next: unknown) => {
    const adapter = adapterRef.current;
    if (!adapter) {
      const message = 'live audio output is not ready';
      setError(message);
      reportError(new Error(message), 'gain');
      return;
    }
    const result = adapter.set(next);
    if (result.kind !== 'applied') {
      const message = messageFor(result);
      setError(message);
      reportError(new Error(message), 'gain');
      return;
    }
    setValue(result.value);
    setError(undefined);
    const nextState: GainPluginState = { value: result.value };
    onState(nextState);
  };

  return (
    <div className="gain-plugin">
      <label>
        <span>gain</span>
        <output>{value.toFixed(2)}</output>
        <input
          aria-label="Gain"
          type="range"
          min={GAIN_CONTROL.min}
          max={GAIN_CONTROL.max}
          step={GAIN_CONTROL.step}
          value={value}
          disabled={!ready || error !== undefined}
          onChange={(event) => update(Number(event.currentTarget.value))}
        />
      </label>
      {error !== undefined && <span role="alert">[ gain unavailable: {error} ]</span>}
    </div>
  );
}

registerPlugin({
  id: 'gain',
  label: 'GAIN',
  kind: 'functional',
  controls: [GAIN_CONTROL],
  mount: GainControl,
});

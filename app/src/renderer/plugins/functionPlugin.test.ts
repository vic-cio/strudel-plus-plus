import { describe, expect, it } from 'vitest';
import {
  applyFunctionPluginValue,
  createFunctionPluginInstance,
  moveFunctionPlugin,
  resolveFunctionPluginTarget,
} from './functionPlugin';
import type { FunctionPluginDef } from './registry';

const gain: FunctionPluginDef = {
  id: 'function-gain',
  label: 'GAIN',
  kind: 'functional',
  scope: 'function',
  functionNames: ['gain'],
  control: {
    kind: 'number',
    id: 'gain',
    label: 'gain',
    argumentIndex: 0,
    min: 0,
    max: 2,
    step: 0.01,
    defaultValue: 1,
  },
  mount: () => null,
};

describe('function plugin instances', () => {
  it('resolves only the exact supported function call under the pointer', () => {
    const source = 'stack(s("bd").gain(0.25), s("hh").gain(0.8))';
    const first = resolveFunctionPluginTarget(source, source.indexOf('gain') + 1, [gain]);
    const second = resolveFunctionPluginTarget(source, source.lastIndexOf('gain') + 1, [gain]);

    expect(first).toMatchObject({ functionName: 'gain', value: 0.25 });
    expect(second).toMatchObject({ functionName: 'gain', value: 0.8 });
    expect(first?.range).not.toEqual(second?.range);
    expect(resolveFunctionPluginTarget(source, source.indexOf('stack') + 1, [gain])).toBeUndefined();
  });

  it('creates a beat-local identity for the exact call and edits only its argument', () => {
    const source = 'stack(s("bd").gain(0.25).pan(0.1), s("hh").gain(0.8))';
    const target = resolveFunctionPluginTarget(source, source.indexOf('gain') + 1, [gain]);
    expect(target).toBeDefined();
    if (!target) return;
    const instance = createFunctionPluginInstance({
      beat: 'drums.js',
      target,
      x: 30,
      y: 40,
      viewport: { width: 800, height: 500 },
    });
    const changed = applyFunctionPluginValue({ source, definition: gain, instance, value: 0.75 });

    expect(instance.instanceId).toContain('drums.js:gain:');
    expect(changed.source).toBe('stack(s("bd").gain(0.75).pan(0.1), s("hh").gain(0.8))');
    expect(changed.instance.value).toBe(0.75);
  });

  it('clamps floating motion without losing beat identity', () => {
    const source = 'gain(1)';
    const target = resolveFunctionPluginTarget(source, 2, [gain]);
    expect(target).toBeDefined();
    if (!target) return;
    const instance = createFunctionPluginInstance({
      beat: 'bass.js',
      target,
      x: 20,
      y: 20,
      viewport: { width: 400, height: 250 },
    });
    if (instance.placement.kind !== 'floating') return;
    const moved = moveFunctionPlugin(
      instance,
      instance.placement.geometry,
      { x: 999, y: 999 },
      { width: 400, height: 250 },
    );

    expect(moved.placement).toMatchObject({ kind: 'floating', geometry: { x: 120, y: 118 } });
    expect(moved.beat).toBe('bass.js');
  });

  it('refuses to edit a different range after ordinary editor changes move the call', () => {
    const source = 's("bd").gain(0.25)';
    const target = resolveFunctionPluginTarget(source, source.indexOf('gain') + 1, [gain]);
    expect(target).toBeDefined();
    if (!target) return;
    const instance = createFunctionPluginInstance({
      beat: 'drums.js',
      target,
      x: 20,
      y: 20,
      viewport: { width: 800, height: 500 },
    });

    expect(() =>
      applyFunctionPluginValue({ source: `// moved\n${source}`, definition: gain, instance, value: 0.75 }),
    ).toThrow(/no longer matches/);
  });
});

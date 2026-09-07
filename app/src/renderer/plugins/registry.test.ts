import { describe, expect, it } from 'vitest';
import {
  getPlugin,
  listFunctionPlugins,
  listPlugins,
  listSessionPlugins,
  registerPlugin,
  type FunctionPluginDef,
  type PluginDef,
} from './registry';

// Registration is global module state, so every test claims its own ids.
const def = (id: string): PluginDef => ({
  id,
  label: id.toUpperCase(),
  kind: 'visual',
  scope: 'session',
  mount: () => null,
});

describe('plugin registry', () => {
  it('lists a plugin it registered, in registration order', () => {
    registerPlugin(def('mixer'));
    registerPlugin(def('scope'));
    const ids = listPlugins().map((plugin) => plugin.id);
    expect(ids).toContain('mixer');
    expect(ids.indexOf('mixer')).toBeLessThan(ids.indexOf('scope'));
  });

  it('hands back the definition by id', () => {
    registerPlugin(def('fader'));
    expect(getPlugin('fader')?.label).toBe('FADER');
    expect(getPlugin('never')).toBeUndefined();
  });

  it('keeps session devices and editor-function controls in one typed catalog', () => {
    const functionDef: FunctionPluginDef = {
      id: 'function-filter',
      label: 'FILTER',
      kind: 'functional',
      scope: 'function',
      functionNames: ['lpf'],
      control: {
        kind: 'number',
        id: 'cutoff',
        label: 'cutoff',
        argumentIndex: 0,
        min: 20,
        max: 20_000,
        step: 1,
        defaultValue: 1_000,
      },
      mount: () => null,
    };
    registerPlugin(functionDef);

    expect(listFunctionPlugins()).toContain(functionDef);
    expect(listSessionPlugins()).not.toContain(functionDef);
  });

  it('refuses a second plugin under an id already taken', () => {
    registerPlugin(def('twice'));
    expect(() => registerPlugin(def('twice'))).toThrow(/already registered/);
  });
});

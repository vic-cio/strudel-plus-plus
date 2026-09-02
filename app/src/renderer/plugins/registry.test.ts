import { describe, expect, it } from 'vitest';
import { getPlugin, listPlugins, registerPlugin, type PluginDef } from './registry';

// Registration is global module state, so every test claims its own ids.
const def = (id: string): PluginDef => ({ id, label: id.toUpperCase(), kind: 'visual', mount: () => null });

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

  it('refuses a second plugin under an id already taken', () => {
    registerPlugin(def('twice'));
    expect(() => registerPlugin(def('twice'))).toThrow(/already registered/);
  });
});

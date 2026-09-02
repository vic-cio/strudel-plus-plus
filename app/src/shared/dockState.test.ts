import { describe, expect, it } from 'vitest';
import { isDockState, normalizeDockState } from './dockState';

describe('isDockState', () => {
  it('accepts well-formed dock state', () => {
    const dock = {
      split: true,
      panes: [{ tabs: ['eq'], active: 'eq' }, { tabs: [] }],
      pluginState: { eq: { gain: 1 } },
    };
    expect(isDockState(dock)).toBe(true);
  });

  it('accepts an empty object', () => {
    expect(isDockState({})).toBe(true);
  });

  it('rejects garbage that is not dock state', () => {
    expect(isDockState('eq')).toBe(false);
    expect(isDockState(null)).toBe(false);
    expect(isDockState({ split: 'yes' })).toBe(false);
    expect(isDockState({ panes: 'one' })).toBe(false);
    expect(isDockState({ panes: [{ tabs: 'eq' }] })).toBe(false);
    expect(isDockState({ panes: [{ active: 7 }] })).toBe(false);
    expect(isDockState({ pluginState: [] })).toBe(false);
  });
});

describe('normalizeDockState', () => {
  it('canonicalizes an empty dock to one empty pane', () => {
    expect(normalizeDockState(undefined, ['eq'])).toEqual({
      split: false,
      panes: [{ tabs: [] }],
    });
  });

  it('drops ids no plugin claims, so old state cannot summon a ghost tab', () => {
    const dock = { panes: [{ tabs: ['eq', 'ghost-mixer'], active: 'ghost-mixer' }] };
    expect(normalizeDockState(dock, ['eq'])).toEqual({
      split: false,
      panes: [{ tabs: ['eq'], active: 'eq' }],
    });
  });

  it('drops an active that is not open and falls back to the first tab', () => {
    const dock = { panes: [{ tabs: ['eq'], active: 'mixer' }] };
    expect(normalizeDockState(dock, ['eq', 'mixer'])).toEqual({
      split: false,
      panes: [{ tabs: ['eq'], active: 'eq' }],
    });
  });

  it('collapses duplicate tabs', () => {
    const dock = { panes: [{ tabs: ['eq', 'eq'] }] };
    expect(normalizeDockState(dock, ['eq']).panes[0]?.tabs).toEqual(['eq']);
  });

  it('keeps two panes only while split', () => {
    const split = { split: true, panes: [{ tabs: ['eq'] }, { tabs: [] }] };
    const normalized = normalizeDockState(split, ['eq']);
    expect(normalized.split).toBe(true);
    expect(normalized.panes).toHaveLength(2);

    const merged = normalizeDockState({ ...split, split: false }, ['eq']);
    expect(merged.split).toBe(false);
    expect(merged.panes).toHaveLength(1);
  });

  it('fills a missing second pane when split', () => {
    const dock = { split: true, panes: [{ tabs: ['eq'] }] };
    expect(normalizeDockState(dock, ['eq']).panes[1]).toEqual({ tabs: [] });
  });

  it('carries plugin state through untouched', () => {
    const pluginState = { eq: { gain: 0.5 }, mixer: { faders: [1, 0.8] } };
    const dock = { panes: [{ tabs: ['eq'] }], pluginState };
    expect(normalizeDockState(dock, ['eq']).pluginState).toEqual(pluginState);
  });

  it('omits plugin state when there is none', () => {
    expect(normalizeDockState({ panes: [{ tabs: [] }] }, ['eq']).pluginState).toBeUndefined();
    expect(normalizeDockState({ pluginState: {} }, ['eq']).pluginState).toBeUndefined();
  });
});

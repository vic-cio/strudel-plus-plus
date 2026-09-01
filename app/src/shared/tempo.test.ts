import { describe, expect, it } from 'vitest';
import { CPS_MAX, CPS_MIN, bpmFromCps, clampCps, cpsFromBpm, hasCodedTempo, parseBpm } from './tempo';

describe('bpm and cps', () => {
  it('reads 0.5 cps as 120 bpm, the strudel default', () => {
    expect(bpmFromCps(0.5)).toBe(120);
  });

  it('converts back again', () => {
    expect(cpsFromBpm(120)).toBeCloseTo(0.5, 9);
  });

  it('round-trips an awkward tempo without drift', () => {
    expect(bpmFromCps(cpsFromBpm(137))).toBeCloseTo(137, 9);
  });

  it('follows the four-beats-per-cycle convention the status bar shows', () => {
    expect(bpmFromCps(1)).toBe(240);
  });
});

describe('parseBpm', () => {
  it('reads a plain number', () => {
    expect(parseBpm('128')).toBe(128);
  });

  it('reads a decimal', () => {
    expect(parseBpm('137.5')).toBe(137.5);
  });

  it('ignores surrounding space', () => {
    expect(parseBpm('  90  ')).toBe(90);
  });

  it('ignores a bpm suffix, since that is what the box is labelled', () => {
    expect(parseBpm('128 bpm')).toBe(128);
  });

  it('rejects text that is not a tempo', () => {
    expect(parseBpm('fast')).toBeUndefined();
  });

  it('rejects an empty box', () => {
    expect(parseBpm('   ')).toBeUndefined();
  });

  it('rejects zero and below, which would stop the clock', () => {
    expect(parseBpm('0')).toBeUndefined();
    expect(parseBpm('-120')).toBeUndefined();
  });
});

describe('hasCodedTempo', () => {
  it('recognises both tempo functions outside comments and strings', () => {
    expect(hasCodedTempo('stack(setcps(0.5), s("bd"))')).toBe(true);
    expect(hasCodedTempo('setcpm ( 90 )')).toBe(true);
  });

  it('does not treat comments or strings as tempo declarations', () => {
    expect(hasCodedTempo('// setcps(0.5)\ns("setcpm(90)")')).toBe(false);
    expect(hasCodedTempo('resetcps(0.5)')).toBe(false);
  });
});

describe('clampCps', () => {
  it('leaves a sane tempo alone', () => {
    expect(clampCps(0.5)).toBe(0.5);
  });

  it('holds the floor, so the clock never stops', () => {
    expect(clampCps(0)).toBe(CPS_MIN);
  });

  it('holds the ceiling, so a typo does not blow up the scheduler', () => {
    expect(clampCps(1000)).toBe(CPS_MAX);
  });

  it('rounds to something a person would recognise', () => {
    expect(clampCps(0.5333333)).toBe(0.5333);
  });
});

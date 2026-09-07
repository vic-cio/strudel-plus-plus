import { describe, expect, it } from 'vitest';
import { nextBoundaryDelayMs } from './beatSwitch';

/**
 * Phase-aligned beat-switch timing.
 *
 * Initiating trigger: clicking another beat while playing with
 * next-bar / next-half-bar latency.
 * Masking condition: the old code waited a fixed one-bar / half-bar interval
 * from the click, hiding the transport phase it should have measured against.
 * Visible symptom: a click a quarter through a bar waited a full bar instead
 * of landing on the next boundary.
 *
 * One Strudel cycle is one bar; cps sets its length. The delay is the time
 * from the click's transport position (`now`, in cycles) to the next
 * boundary, never a fixed interval. An exact boundary schedules the NEXT
 * boundary rather than double-triggering the current one.
 */
describe('nextBoundaryDelayMs', () => {
  const CPS = 0.5; // 2000ms per bar, 1000ms per half-bar.
  const BAR = 2000;
  const HALF = 1000;

  it('waits a full bar from the exact start of a bar', () => {
    expect(nextBoundaryDelayMs(10, CPS, 'next-bar')).toBe(BAR);
  });

  it('waits a half bar from the exact start for half-bar timing', () => {
    expect(nextBoundaryDelayMs(10, CPS, 'next-half-bar')).toBe(HALF);
  });

  it('lands on the next bar from a quarter through the bar', () => {
    // Fixed-delay counterfactual: a full BAR (2000ms) from 10.25 would land
    // at 11.25, a quarter bar late. Phase-aligned lands on 11.0.
    expect(nextBoundaryDelayMs(10.25, CPS, 'next-bar')).toBe(1500);
  });

  it('lands on the next half-bar from a quarter through the bar', () => {
    expect(nextBoundaryDelayMs(10.25, CPS, 'next-half-bar')).toBe(500);
  });

  it('fires almost immediately just before a bar boundary', () => {
    const delay = nextBoundaryDelayMs(10.999, CPS, 'next-bar');
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThan(10);
  });

  it('fires almost immediately just before a half-bar boundary', () => {
    const delay = nextBoundaryDelayMs(10.499, CPS, 'next-half-bar');
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThan(10);
  });

  it('schedules the next bar when clicked exactly on a bar line', () => {
    // At 11.0 exactly, the next bar is 12.0 — never 0ms (double-trigger).
    expect(nextBoundaryDelayMs(11, CPS, 'next-bar')).toBe(BAR);
  });

  it('schedules the next half-bar when clicked exactly on a half-bar line', () => {
    // At 10.5 exactly, the next half-bar is 11.0.
    expect(nextBoundaryDelayMs(10.5, CPS, 'next-half-bar')).toBe(HALF);
    expect(nextBoundaryDelayMs(10, CPS, 'next-half-bar')).toBe(HALF);
  });

  it('measures a half-bar from the second half of the bar', () => {
    // At 10.75, the next half-bar (11.0) is also the next bar.
    expect(nextBoundaryDelayMs(10.75, CPS, 'next-half-bar')).toBe(500);
    expect(nextBoundaryDelayMs(10.75, CPS, 'next-bar')).toBe(500);
  });

  it('scales with cps: a faster transport means shorter waits', () => {
    // cps 1 → 1000ms per bar. Quarter through → 750ms to the next bar.
    expect(nextBoundaryDelayMs(4.25, 1, 'next-bar')).toBe(750);
    expect(nextBoundaryDelayMs(4.25, 1, 'next-half-bar')).toBe(250);
  });

  it('falls back to a full interval for a non-positive cps', () => {
    expect(nextBoundaryDelayMs(10.25, 0, 'next-bar')).toBe(0);
    expect(nextBoundaryDelayMs(10.25, -1, 'next-half-bar')).toBe(0);
  });
});

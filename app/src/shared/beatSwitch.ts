import type { BeatSwitchTiming } from './settings';

/**
 * Phase-aligned beat-switch delay.
 *
 * One Strudel cycle is one bar; `cps` sets its length. `nowCycle` is the live
 * transport position in cycles (e.g. `scheduler.now()`), whose fractional
 * part is the phase within the current bar. The delay is the time from the
 * click to the NEXT boundary — never a fixed one-bar / half-bar interval
 * from the click.
 *
 * An exact boundary schedules the next boundary (EPS nudges the floor past
 * floating-point exactness) rather than double-triggering the current one.
 */
const EPS = 1e-9;

export type BoundaryTiming = Extract<BeatSwitchTiming, 'next-bar' | 'next-half-bar'>;

export function nextBoundaryDelayMs(nowCycle: number, cps: number, timing: BoundaryTiming | BeatSwitchTiming): number {
  if (!Number.isFinite(nowCycle)) {
    return 0;
  }
  const FALLBACK_MS = 2000; // fixed interval for non-playing / zero-cps
  if (cps <= 0) {
    return FALLBACK_MS;
  }
  let next: number;
  if (timing === 'next-half-bar') {
    next = (Math.floor(nowCycle * 2 + EPS) + 1) / 2;
  } else if (timing === 'next-bar') {
    next = Math.floor(nowCycle + EPS) + 1;
  } else {
    return 0;
  }
  return Math.max(0, Math.round(((next - nowCycle) * 1000) / cps));
}

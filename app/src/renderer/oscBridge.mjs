import { Pattern } from '@strudel/core';
import { parseControlsFromHap } from '@strudel/osc/osc.mjs';
import { getPerformanceTime } from './audioClock.mjs';

/**
 * `.osc()` for the desktop app.
 *
 * The browser build of @strudel/osc opens a websocket to a separate process
 * that owns the UDP socket. Here the main process owns it, so this
 * only has to shape the message. Same wire format either way: /dirt/play with a
 * flat key, value, key, value list, wrapped in a bundle whose timetag says when
 * the sound lands.
 */
export function oscTrigger(hap, currentTime, cps = 1, targetTime) {
  const timeMs = getPerformanceTime(targetTime);
  if (!timeMs) {
    return;
  }
  const controls = parseControlsFromHap(hap, cps);
  const message = {
    address: '/dirt/play',
    args: Object.entries(controls).flat(),
    timestamp: performance.timeOrigin + timeMs,
  };
  if ('oschost' in hap.value) {
    message.host = hap.value.oschost;
  }
  if ('oscport' in hap.value) {
    message.port = hap.value.oscport;
  }
  window.desktop.osc.send(message);
}

Pattern.prototype.osc = function () {
  return this.onTrigger(oscTrigger);
};

export const superdirtOutput = (hap, deadline, hapDuration, cps, targetTime) =>
  oscTrigger(hap, deadline, cps, targetTime);

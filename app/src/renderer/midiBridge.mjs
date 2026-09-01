import { Pattern, getEventOffsetMs, noteToMidi } from '@strudel/core';

const ON = 0x90;
const OFF = 0x80;
const CC = 0xb0;

// The audio engine and the MIDI port do not agree on when "now" is. This is the
// same constant the Tauri bridge uses, arrived at by ear rather than by maths.
const LATENCY_MS = 34;

/**
 * `.midi()` for the desktop app.
 *
 * Adapted from the upstream desktop MIDI bridge, which exists because Web
 * MIDI is not usable in a desktop shell. Under Electron the symptom is worse
 * than an error: navigator.requestMIDIAccess returns a promise that never
 * settles, so @strudel/midi would leave the pattern silent and say nothing.
 * The main process holds the RtMidi port instead.
 */
Pattern.prototype.midi = function (output) {
  return this.onTrigger((hap, currentTime, cps, targetTime) => {
    const { note, ccn, ccv, velocity = 0.9, gain = 1 } = hap.value;
    const offset = Math.round(getEventOffsetMs(targetTime, currentTime) + LATENCY_MS);
    const level = Math.floor(gain * velocity * 100);
    const duration = Math.floor((hap.duration.valueOf() / cps) * 1000 - 10);
    const channel = (hap.value.midichan ?? 1) - 1;
    const port = output ?? 'IAC';
    const messages = [];

    if (note != null) {
      const number = typeof note === 'number' ? note : noteToMidi(note);
      messages.push({ port, message: [ON + channel, number, level], offset });
      messages.push({ port, message: [OFF + channel, number, level], offset: offset + duration });
    }

    if (ccv != null && ccn != null) {
      if (typeof ccv !== 'number' || ccv < 0 || ccv > 1) {
        throw new Error('expected ccv to be a number between 0 and 1');
      }
      if (!['string', 'number'].includes(typeof ccn)) {
        throw new Error('expected ccn to be a number or a string');
      }
      messages.push({ port, message: [CC + channel, ccn, Math.round(ccv * 127)], offset });
    }

    if (messages.length) {
      window.desktop.midi.send(messages);
    }
  });
};

export const midiPorts = () => window.desktop.midi.ports();

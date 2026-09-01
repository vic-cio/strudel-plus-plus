import { describe, expect, it } from 'vitest';
import { NTP_EPOCH_OFFSET, encodeBundle, encodeMessage, encodeString } from './osc';

const bytes = (buffer: Buffer) => Array.from(buffer);

describe('encodeString', () => {
  it('null-terminates and pads to a multiple of four', () => {
    expect(bytes(encodeString('/a'))).toEqual([0x2f, 0x61, 0, 0]);
  });

  it('adds a whole word of padding when the length is already a multiple of four', () => {
    // The terminator is mandatory, so "/abc" cannot end at four bytes.
    expect(encodeString('/abc')).toHaveLength(8);
  });

  it('encodes an empty string as one padded word', () => {
    expect(bytes(encodeString(''))).toEqual([0, 0, 0, 0]);
  });
});

describe('encodeMessage', () => {
  it('writes address, type tag and string arguments', () => {
    const packet = encodeMessage('/a', ['bd']);
    expect(bytes(packet)).toEqual([
      0x2f,
      0x61,
      0,
      0, // "/a"
      0x2c,
      0x73,
      0,
      0, // ",s"
      0x62,
      0x64,
      0,
      0, // "bd"
    ]);
  });

  it('tags a whole number as an int and writes it big-endian', () => {
    const packet = encodeMessage('/a', [1]);
    expect(bytes(packet).slice(4, 8)).toEqual([0x2c, 0x69, 0, 0]); // ",i"
    expect(bytes(packet).slice(8)).toEqual([0, 0, 0, 1]);
  });

  it('tags a fractional number as a float', () => {
    const packet = encodeMessage('/a', [0.5]);
    expect(bytes(packet).slice(4, 8)).toEqual([0x2c, 0x66, 0, 0]); // ",f"
    expect(packet.readFloatBE(8)).toBe(0.5);
  });

  it('keeps mixed arguments in order', () => {
    // SuperDirt reads /dirt/play as a flat key, value, key, value list, so the
    // order is the message.
    const packet = encodeMessage('/dirt/play', ['s', 'bd', 'gain', 0.8]);
    expect(packet.subarray(12, 20).toString('latin1').replace(/\0+$/, '')).toBe(',sssf');
  });

  it('produces a length that is always a multiple of four', () => {
    expect(encodeMessage('/dirt/play', ['s', 'bd', 'n', 3]).length % 4).toBe(0);
  });
});

describe('encodeBundle', () => {
  it('starts with the #bundle marker', () => {
    const packet = encodeBundle(0, [encodeMessage('/a', [])]);
    expect(packet.subarray(0, 8).toString('latin1')).toBe('#bundle\0');
  });

  it('writes the timetag as NTP seconds and fraction', () => {
    // Half a second past the unix epoch.
    const packet = encodeBundle(500, [encodeMessage('/a', [])]);
    expect(packet.readUInt32BE(8)).toBe(NTP_EPOCH_OFFSET);
    expect(packet.readUInt32BE(12)).toBe(0x80000000);
  });

  it('prefixes each element with its length', () => {
    const message = encodeMessage('/a', []);
    const packet = encodeBundle(0, [message]);
    expect(packet.readUInt32BE(16)).toBe(message.length);
    expect(bytes(packet.subarray(20))).toEqual(bytes(message));
  });

  it('carries several messages in one bundle', () => {
    const one = encodeMessage('/a', []);
    const two = encodeMessage('/bb', ['x']);
    const packet = encodeBundle(0, [one, two]);
    expect(packet).toHaveLength(16 + 4 + one.length + 4 + two.length);
  });
});

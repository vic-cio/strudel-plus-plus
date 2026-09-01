import { createSocket } from 'node:dgram';
import { describe, expect, it } from 'vitest';
import { createOscSender } from './oscSender';

/** Bind an ephemeral port so a real SuperDirt on 57120 is never disturbed. */
function listenOnce(): Promise<{ port: number; message: Promise<Buffer> }> {
  const socket = createSocket('udp4');
  const message = new Promise<Buffer>((resolve) => {
    socket.on('message', (data) => {
      socket.close();
      resolve(data);
    });
  });
  return new Promise((ready) => {
    socket.bind(0, '127.0.0.1', () => ready({ port: socket.address().port, message }));
  });
}

describe('createOscSender', () => {
  it('sends a timestamped hap as a bundle a listener can read', async () => {
    const { port, message } = await listenOnce();
    createOscSender().send({
      address: '/dirt/play',
      args: ['s', 'bd', 'gain', 0.8, 'n', 3],
      timestamp: Date.now() + 100,
      port,
    });
    const packet = await message;

    expect(packet.subarray(0, 8).toString('latin1')).toBe('#bundle\0');
    const text = packet.toString('latin1');
    expect(text).toContain('/dirt/play');
    // s and bd and gain and n are strings, 0.8 is a float, 3 is an int.
    expect(text).toContain(',sssfsi');
  }, 8000);

  it('sends an untimed message on its own, with no bundle wrapper', async () => {
    const { port, message } = await listenOnce();
    createOscSender().send({ address: '/ping', args: [], port });
    const packet = await message;

    expect(packet.subarray(0, 5).toString('latin1')).toBe('/ping');
    expect(packet.toString('latin1')).not.toContain('#bundle');
  }, 8000);
});

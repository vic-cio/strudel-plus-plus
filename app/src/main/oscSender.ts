import { createSocket, type Socket } from 'node:dgram';
import { encodeBundle, encodeMessage } from './osc';

export const SUPERDIRT_HOST = '127.0.0.1';
export const SUPERDIRT_PORT = 57120;

export type OscMessage = {
  address: string;
  args: (string | number)[];
  /** Unix milliseconds the sound should land. Omitted means play it now. */
  timestamp?: number;
  host?: string;
  port?: number;
};

/**
 * Holds the UDP socket for the whole app.
 *
 * A timestamped message goes out as a bundle, which is how SuperDirt gets
 * sample-accurate timing: the scheduler sends early and the timetag says when.
 */
export function createOscSender() {
  let socket: Socket | undefined;

  return {
    send(message: OscMessage) {
      socket ??= createSocket('udp4');
      const packet = encodeMessage(message.address, message.args);
      const payload = message.timestamp === undefined ? packet : encodeBundle(message.timestamp, [packet]);
      socket.send(payload, message.port ?? SUPERDIRT_PORT, message.host ?? SUPERDIRT_HOST);
    },
    close() {
      socket?.close();
      socket = undefined;
    },
  };
}

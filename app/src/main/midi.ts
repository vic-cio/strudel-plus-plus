import { Output } from '@julusian/midi';

export type MidiMessage = {
  /** A fragment of the destination port's name, matched case-insensitively. */
  port: string;
  /** Status byte and up to two data bytes. */
  message: number[];
  /** Milliseconds from now to send it. */
  offset: number;
};

/**
 * Find the output to send to.
 *
 * A pattern names a port with a fragment, not an exact string, because device
 * names carry vendor noise nobody wants to type. When nothing matches, the
 * first port is a better answer than silence: the pattern is already playing,
 * and hearing the wrong device says more than hearing nothing.
 */
export function pickPort(names: string[], requested: string): number | undefined {
  if (names.length === 0) {
    return undefined;
  }
  const needle = requested.toLowerCase();
  const found = names.findIndex((name) => name.toLowerCase().includes(needle));
  return found === -1 ? 0 : found;
}

/**
 * MIDI output for the whole app.
 *
 * RtMidi wants a port opened before it will take anything, and reopening per
 * message costs milliseconds that a drum pattern cannot spare, so the open port
 * is held until a different one is asked for.
 */
export function createMidiOut() {
  const output = new Output();
  let openPort: number | undefined;

  const portNames = () => {
    const names: string[] = [];
    for (let index = 0; index < output.getPortCount(); index += 1) {
      names.push(output.getPortName(index));
    }
    return names;
  };

  function ensureOpen(requested: string): boolean {
    const index = pickPort(portNames(), requested);
    if (index === undefined) {
      return false;
    }
    if (index !== openPort) {
      if (openPort !== undefined) {
        output.closePort();
      }
      output.openPort(index);
      openPort = index;
    }
    return true;
  }

  return {
    ports: portNames,

    send(messages: MidiMessage[]) {
      for (const { port, message, offset } of messages) {
        if (!ensureOpen(port)) {
          return;
        }
        // The scheduler sends ahead of time and says how far ahead, so the
        // note lands with the audio rather than when the IPC happened to
        // arrive. Anything already due goes out now.
        if (offset <= 0) {
          output.sendMessage(message);
        } else {
          setTimeout(() => output.sendMessage(message), offset);
        }
      }
    },

    close() {
      if (openPort !== undefined) {
        output.closePort();
        openPort = undefined;
      }
    },
  };
}

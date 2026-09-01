/**
 * Just enough of OSC 1.0 to talk to SuperDirt.
 *
 * Every value is padded to a four-byte word, and every string carries a
 * terminator before that padding, so "/abc" takes eight bytes rather than four.
 */

export const NTP_EPOCH_OFFSET = 2_208_988_800; // seconds between 1900 and 1970

const pad = (length: number) => (4 - (length % 4)) % 4;

export function encodeString(value: string): Buffer {
  const raw = Buffer.from(value, 'latin1');
  const terminated = raw.length + 1;
  return Buffer.concat([raw, Buffer.alloc(1 + pad(terminated))]);
}

export function encodeMessage(address: string, args: (string | number)[]): Buffer {
  let tags = ',';
  const encoded: Buffer[] = [];
  for (const arg of args) {
    if (typeof arg === 'string') {
      tags += 's';
      encoded.push(encodeString(arg));
    } else if (Number.isInteger(arg)) {
      tags += 'i';
      const int = Buffer.alloc(4);
      int.writeInt32BE(arg);
      encoded.push(int);
    } else {
      tags += 'f';
      const float = Buffer.alloc(4);
      float.writeFloatBE(arg);
      encoded.push(float);
    }
  }
  return Buffer.concat([encodeString(address), encodeString(tags), ...encoded]);
}

export function encodeBundle(unixMs: number, elements: Buffer[]): Buffer {
  const timetag = Buffer.alloc(8);
  const seconds = Math.floor(unixMs / 1000);
  const fraction = (unixMs - seconds * 1000) / 1000;
  timetag.writeUInt32BE(seconds + NTP_EPOCH_OFFSET, 0);
  timetag.writeUInt32BE(Math.round(fraction * 0x100000000) >>> 0, 4);

  const sized = elements.flatMap((element) => {
    const size = Buffer.alloc(4);
    size.writeUInt32BE(element.length);
    return [size, element];
  });
  return Buffer.concat([encodeString('#bundle'), timetag, ...sized]);
}

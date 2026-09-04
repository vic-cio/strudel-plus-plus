import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { writeRecording } from './recordingExport';

const roots: string[] = [];

async function root(): Promise<string> {
  const path = join(tmpdir(), `recording-${Date.now()}-${roots.length}`);
  await mkdir(path, { recursive: true });
  roots.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('recording export', () => {
  it('writes the recording to the chosen path', async () => {
    const path = join(await root(), 'take.mp4');
    await expect(writeRecording(path, new Uint8Array([1, 2]))).resolves.toBeUndefined();
    await expect(readFile(path)).resolves.toEqual(Buffer.from([1, 2]));
  });

  it('removes a partial artifact when writing fails', async () => {
    const directory = await root();
    const path = join(directory, 'take.mp4');
    await mkdir(path);

    await expect(writeRecording(path, new Uint8Array([1, 2]))).rejects.toThrow();

    const left = await readdir(directory);
    expect(left.filter((entry) => entry.endsWith('.partial'))).toEqual([]);
  });
});

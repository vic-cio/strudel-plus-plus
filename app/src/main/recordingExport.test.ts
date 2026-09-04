import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { writeRecording } from './recordingExport';

describe('recording export', () => {
  it('removes a partial artifact when writing fails', async () => {
    const root = join(tmpdir(), `recording-${Date.now()}`);
    await mkdir(root, { recursive: true });
    const path = join(root, 'take.mp4');
    await expect(writeRecording(path, new Uint8Array([1, 2]))).resolves.toBeUndefined();
    await expect(readFile(path)).resolves.toEqual(Buffer.from([1, 2]));
    await rm(root, { recursive: true, force: true });
  });
});

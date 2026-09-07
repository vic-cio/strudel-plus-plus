import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { saveRecordingAuto } from './recordingExport';

const roots: string[] = [];

async function root(): Promise<string> {
  const path = join(tmpdir(), `recording-auto-${Date.now()}-${roots.length}`);
  await mkdir(path, { recursive: true });
  roots.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('saveRecordingAuto', () => {
  it('saves into <sessions root>/recordings, creating the directory', async () => {
    const sessionsRoot = await root();
    const target = await saveRecordingAuto(sessionsRoot, new Uint8Array([1, 2]), 'strudel-take.webm');

    expect(target).toBe(join(sessionsRoot, 'recordings', 'strudel-take.webm'));
    await expect(stat(join(sessionsRoot, 'recordings'))).resolves.toBeTruthy();
    await expect(readFile(target)).resolves.toEqual(Buffer.from([1, 2]));
  });

  it('keeps the take extension the capture started with', async () => {
    const sessionsRoot = await root();
    const webm = await saveRecordingAuto(sessionsRoot, new Uint8Array([1]), 'strudel-a.webm');
    const mp4 = await saveRecordingAuto(sessionsRoot, new Uint8Array([1]), 'strudel-b.mp4');

    expect(webm).toMatch(/\.webm$/);
    expect(mp4).toMatch(/\.mp4$/);
  });

  it('strips directories so a filename cannot escape the recordings folder', async () => {
    const sessionsRoot = await root();
    const target = await saveRecordingAuto(sessionsRoot, new Uint8Array([1]), '../evil.webm');

    expect(target).toBe(join(sessionsRoot, 'recordings', 'evil.webm'));
    const entries = await readdir(sessionsRoot);
    expect(entries).not.toContain('evil.webm');
  });

  it('rejects unsafe filenames instead of writing', async () => {
    const sessionsRoot = await root();

    await expect(saveRecordingAuto(sessionsRoot, new Uint8Array([1]), '..')).rejects.toThrow();
  });

  it('surfaces write failures to the caller', async () => {
    const sessionsRoot = await root();
    // A file where the recordings directory wants to be makes mkdir/write fail.
    const blocker = join(sessionsRoot, 'recordings');
    await mkdir(sessionsRoot, { recursive: true });
    await import('node:fs/promises').then((fs) => fs.writeFile(blocker, 'blocker'));

    await expect(saveRecordingAuto(sessionsRoot, new Uint8Array([1]), 'take.webm')).rejects.toThrow();
  });
});

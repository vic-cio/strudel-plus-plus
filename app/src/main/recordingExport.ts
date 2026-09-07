import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { RECORDINGS_DIR, sanitizeRecordingFilename } from '../shared/recordingDestination';

/** Write atomically enough for a user-visible export: a failed write cannot
 * leave a file that looks like a successful recording. */
export async function writeRecording(path: string, data: Uint8Array): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${Date.now()}.partial`);
  try {
    await writeFile(temporary, data);
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

/**
 * Auto-save a take into `<sessions root>/recordings`, creating the folder at
 * the filesystem boundary. The filename is sanitized so a renderer-supplied
 * name cannot escape the folder; the caller keeps its generated filename
 * and extension. Resolves with the written path; rejects on any failure so
 * the renderer can surface it.
 */
export async function saveRecordingAuto(
  sessionsRoot: string,
  data: Uint8Array,
  suggestedName: string,
): Promise<string> {
  const safe = sanitizeRecordingFilename(suggestedName);
  const dir = join(sessionsRoot, RECORDINGS_DIR);
  await mkdir(dir, { recursive: true });
  const target = join(dir, safe);
  await writeRecording(target, data);
  return target;
}

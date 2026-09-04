import { rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';

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

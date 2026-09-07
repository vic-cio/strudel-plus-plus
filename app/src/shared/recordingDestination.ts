/**
 * Where a recording lands when the save dialog is off.
 *
 * The auto-save destination is `<sessions root>/recordings/<filename>`. These
 * helpers stay pure (no fs, no node:path) so renderer and main share the
 * naming and the traversal guard; the main process joins against its own
 * root and creates the directory at the filesystem boundary.
 */
export const RECORDINGS_DIR = 'recordings';

export function buildRecordingFilename(beatName: string | undefined, stamp: string, extension: string): string {
  const base = (beatName ?? '').replace(/\.js$/, '').trim() || 'take';
  const safeBase = base.replace(/[/\\]/g, '-');
  return `strudel-${safeBase}-${stamp}.${extension}`;
}

export function sanitizeRecordingFilename(suggestedName: string): string {
  const base = suggestedName.split(/[/\\]/).at(-1)?.trim() ?? '';
  if (!base || base === '.' || base === '..') {
    throw new Error(`Refusing unsafe recording filename: ${JSON.stringify(suggestedName)}`);
  }
  if (base.includes('\0')) {
    throw new Error(`Refusing unsafe recording filename: ${JSON.stringify(suggestedName)}`);
  }
  return base;
}

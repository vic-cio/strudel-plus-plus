export type DiskChange = {
  diskContent: string;
  bufferContent: string;
  lastSavedContent: string;
};

export type Resolution =
  | { kind: 'noop' }
  | { kind: 'apply'; content: string }
  | { kind: 'conflict'; diskContent: string };

/**
 * Decide what to do when the beats folder reports a write.
 *
 * The watcher cannot tell our own saves from an agent's edit, and it fires
 * after a delay, so a stale echo of our last save can arrive while the user is
 * mid-phrase. The first two rules discard those. Only a genuinely new disk
 * content reaches the third, and it never overwrites unsaved work.
 */
export function resolveDiskChange({ diskContent, bufferContent, lastSavedContent }: DiskChange): Resolution {
  // The disk holds exactly what we last wrote, so nobody else has touched it.
  if (diskContent === lastSavedContent) {
    return { kind: 'noop' };
  }
  // Someone wrote, but it landed on what the buffer already shows.
  if (diskContent === bufferContent) {
    return { kind: 'noop' };
  }
  // Nothing unsaved to lose, so the edit can go live.
  if (bufferContent === lastSavedContent) {
    return { kind: 'apply', content: diskContent };
  }
  return { kind: 'conflict', diskContent };
}

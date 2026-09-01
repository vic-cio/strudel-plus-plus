import { describe, expect, it } from 'vitest';
import { findOnPath } from './which';

const PATH = '/Users/vic/.local/bin:/opt/homebrew/bin:/usr/bin';
const exists = (candidate: string) => ['/Users/vic/.local/bin/claude', '/usr/bin/zsh'].includes(candidate);

describe('findOnPath', () => {
  it('finds a command in the first directory that holds it', () => {
    expect(findOnPath('claude', PATH, exists)).toBe('/Users/vic/.local/bin/claude');
  });

  it('keeps looking past directories that do not hold it', () => {
    expect(findOnPath('zsh', PATH, exists)).toBe('/usr/bin/zsh');
  });

  it('reports nothing for a command that is not on the path', () => {
    // This is the case worth naming. node-pty exits 1 and prints nothing at all
    // when the command is missing, so without this check the pane shows a bare
    // "[exited 1]" and there is no way to tell a missing binary from a crash.
    expect(findOnPath('codex', PATH, exists)).toBeUndefined();
  });

  it('takes an absolute command as given, without searching', () => {
    expect(findOnPath('/usr/bin/zsh', PATH, exists)).toBe('/usr/bin/zsh');
  });

  it('reports nothing for an absolute command that does not exist', () => {
    expect(findOnPath('/nope/claude', PATH, exists)).toBeUndefined();
  });

  it('ignores empty segments in the path', () => {
    expect(findOnPath('zsh', '::/usr/bin:', exists)).toBe('/usr/bin/zsh');
  });
});

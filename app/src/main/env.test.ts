import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { PATH_END, PATH_START, extractPath, pathScript } from './env';

const PATH = '/Users/vic/.local/bin:/opt/homebrew/bin:/usr/bin';

describe('extractPath', () => {
  it('takes the path from between the markers', () => {
    expect(extractPath(`${PATH_START}${PATH}${PATH_END}`)).toBe(PATH);
  });

  it('ignores an interactive shell banner printed before the path', () => {
    // zsh -lic runs /etc/zshrc_Apple_Terminal, which announces itself. Without
    // the markers that banner lands in PATH and every harness fails to launch.
    const noisy = `Restored session: Sat 29 Aug 2026 18:03:54 BST\n${PATH_START}${PATH}${PATH_END}`;
    expect(extractPath(noisy)).toBe(PATH);
  });

  it('ignores output printed after the path', () => {
    expect(extractPath(`${PATH_START}${PATH}${PATH_END}\nSaving session...`)).toBe(PATH);
  });

  it('trims stray whitespace around the path', () => {
    expect(extractPath(`${PATH_START}\n  ${PATH}  \n${PATH_END}`)).toBe(PATH);
  });

  it('returns undefined when the markers never arrived', () => {
    expect(extractPath('Restored session: Sat 29 Aug 2026')).toBeUndefined();
  });

  it('returns undefined when the path between the markers is empty', () => {
    expect(extractPath(`${PATH_START}   ${PATH_END}`)).toBeUndefined();
  });
});

describe('pathScript', () => {
  it('round-trips a real PATH through a real shell', () => {
    // The unit tests above feed extractPath a well-formed string, so they can
    // never catch the script emitting a malformed one. It did: "$PATH" followed
    // by a marker starting with an underscore reads as one variable name, so
    // the shell expanded $PATH__strudel_path_end__, found nothing, and the app
    // silently fell back to whatever PATH it was launched with. From a terminal
    // that looks fine. From Finder it is the bare launchd PATH and every
    // harness disappears.
    const output = execFileSync('/bin/sh', ['-c', pathScript()], {
      encoding: 'utf8',
      env: { PATH: '/tmp/one:/tmp/two' },
    });
    expect(extractPath(output)).toBe('/tmp/one:/tmp/two');
  });

  it('survives a shell that chatters on the way in and out', () => {
    const output = execFileSync('/bin/sh', ['-c', `echo noise; ${pathScript()}; echo more >&2`], {
      encoding: 'utf8',
      env: { PATH: '/tmp/one' },
    });
    expect(extractPath(output)).toBe('/tmp/one');
  });
});

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { resolveHarness, type HarnessConfig } from './harness';

const config: HarnessConfig = {
  beatsRoot: '/beats',
  harnesses: [
    { id: 'claude', label: 'Claude Code', command: 'claude' },
    { id: 'pi', label: 'pi', command: 'pi', args: ['--no-session'] },
    { id: 'shell', label: 'Shell', command: 'zsh', args: ['-l'] },
  ],
};

describe('resolveHarness', () => {
  it('keeps global Codex hooks out of app helpers', async () => {
    const configured = JSON.parse(await readFile(new URL('../../harnesses.json', import.meta.url), 'utf8')) as {
      harnesses: Array<{ id: string; args?: string[] }>;
    };
    const codex = configured.harnesses.find((harness) => harness.id === 'codex');

    expect(codex?.args).toEqual(expect.arrayContaining(['--disable', 'hooks']));
  });

  it('resolves a known harness to its command', () => {
    expect(resolveHarness('claude', config)).toEqual({ command: 'claude', args: [], cwd: '/beats' });
  });

  it('carries the configured arguments through', () => {
    expect(resolveHarness('pi', config)).toEqual({
      command: 'pi',
      args: ['--no-session'],
      cwd: '/beats',
    });
  });

  it('always runs in the beats folder', () => {
    for (const id of ['claude', 'pi', 'shell']) {
      expect(resolveHarness(id, config).cwd).toBe('/beats');
    }
  });

  it('throws on an unknown harness id', () => {
    expect(() => resolveHarness('nope', config)).toThrow(/unknown harness: nope/i);
  });
});

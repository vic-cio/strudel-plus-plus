import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSessionStore } from './sessions';
import { DEFAULT_AGENTS_MD, DEFAULT_SKILLS } from './harnessContent';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'harness-content-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const SKILL_ROOTS = ['.claude', '.agents'] as const;

function skillPath(dir: string, name: string): string {
  return join(root, dir, 'skills', name, 'SKILL.md');
}

describe('seedHarnessContent', () => {
  it('seeds AGENTS.md and both skill folders on a fresh root', async () => {
    await createSessionStore(root).list();
    await expect(readFile(join(root, 'AGENTS.md'), 'utf8')).resolves.toBe(DEFAULT_AGENTS_MD);
    for (const dir of SKILL_ROOTS) {
      for (const name of Object.keys(DEFAULT_SKILLS)) {
        await expect(readFile(skillPath(dir, name), 'utf8')).resolves.toBe(DEFAULT_SKILLS[name]!);
      }
    }
  });

  it('seeds skills the harnesses actually look up: .claude/skills and .agents/skills', async () => {
    // Claude Code reads .claude/skills/<name>/SKILL.md; pi reads
    // .agents/skills/<name>/SKILL.md. Both are linked into every session.
    await createSessionStore(root).list();
    const claude = await readdir(join(root, '.claude', 'skills'));
    const agents = await readdir(join(root, '.agents', 'skills'));
    expect(claude.sort()).toEqual(Object.keys(DEFAULT_SKILLS).sort());
    expect(agents.sort()).toEqual(Object.keys(DEFAULT_SKILLS).sort());
  });

  it('writes skills with frontmatter whose name matches the folder', async () => {
    await createSessionStore(root).list();
    for (const dir of SKILL_ROOTS) {
      for (const [name, content] of Object.entries(DEFAULT_SKILLS)) {
        const frontmatter = content.split('---')[1] ?? '';
        expect(frontmatter).toContain(`name: ${name}`);
        expect(frontmatter).toMatch(/description: \S/);
      }
    }
  });

  it('never overwrites an AGENTS.md the root already has', async () => {
    await writeFile(join(root, 'AGENTS.md'), '# my own instructions');
    await createSessionStore(root).list();
    await expect(readFile(join(root, 'AGENTS.md'), 'utf8')).resolves.toBe('# my own instructions');
  });

  it('leaves an existing .claude or .agents folder exactly as it is', async () => {
    await mkdir(join(root, '.claude'), { recursive: true });
    await writeFile(join(root, '.claude', 'settings.json'), '{"own": true}');
    await mkdir(join(root, '.agents', 'skills', 'mine'), { recursive: true });
    await writeFile(join(root, '.agents', 'skills', 'mine', 'SKILL.md'), '---\nname: mine\ndescription: mine\n---\n');
    await createSessionStore(root).list();
    await expect(readFile(join(root, '.claude', 'settings.json'), 'utf8')).resolves.toBe('{"own": true}');
    await expect(readdir(join(root, '.claude', 'skills'))).rejects.toThrow();
    await expect(readdir(join(root, '.agents', 'skills'))).resolves.toEqual(['mine']);
  });

  it('seeds around a partially furnished root', async () => {
    // AGENTS.md stays, the missing skill folders still appear.
    await writeFile(join(root, 'AGENTS.md'), '# mine');
    await createSessionStore(root).list();
    await expect(readFile(join(root, 'AGENTS.md'), 'utf8')).resolves.toBe('# mine');
    await expect(readFile(skillPath('.claude', 'edit-live-beat'), 'utf8')).resolves.toBeDefined();
    await expect(readFile(skillPath('.agents', 'live-audio-state'), 'utf8')).resolves.toBeDefined();
  });

  it('is idempotent across repeated listings', async () => {
    const store = createSessionStore(root);
    await store.list();
    await writeFile(join(root, 'AGENTS.md'), '# the human replaced it');
    await store.list();
    await expect(readFile(join(root, 'AGENTS.md'), 'utf8')).resolves.toBe('# the human replaced it');
    await expect(readFile(skillPath('.claude', 'edit-live-beat'), 'utf8')).resolves.toBe(
      DEFAULT_SKILLS['edit-live-beat']!,
    );
  });

  it('pins the edit-live-beat skill to the session state beat pointer alone', async () => {
    // The harness must edit exactly the file .session.json names — never a
    // guess, never a fallback to the first beat file. A stale pointer once
    // made an agent edit the first beat the session was ever opened with
    // while another beat was on screen.
    await createSessionStore(root).list();
    const skill = (await readFile(skillPath('.claude', 'edit-live-beat'), 'utf8')).replace(/\s+/g, ' ');
    expect(skill).toMatch(/ONLY/i);
    expect(skill).toContain('never fall back');
    expect(skill).toMatch(/first beat file/);
  });

  it('tells the agent to ask when the beat pointer is missing or ambiguous', async () => {
    await createSessionStore(root).list();
    // Missing state, unreadable state, a beat that does not exist: the answer
    // is always the same — ask, never choose.
    const skill = (await readFile(skillPath('.agents', 'edit-live-beat'), 'utf8')).replace(/\s+/g, ' ');
    expect(skill).toMatch(/missing or unreadable/);
    expect(skill).toMatch(/does not exist/);
    expect(skill).toMatch(/ask the human which beat to edit/i);
    expect(skill).toMatch(/instead of choosing/i);
  });

  it('carries the same beat-pointer guard in the seeded AGENTS.md', async () => {
    await createSessionStore(root).list();
    const agents = (await readFile(join(root, 'AGENTS.md'), 'utf8')).replace(/\s+/g, ' ');
    expect(agents).toMatch(/only source of truth/);
    expect(agents).toMatch(/never fall back/);
    expect(agents).toMatch(/ask the human which beat to edit/i);
  });
});

describe('shared content backfill for a pre-existing session', () => {
  it('links the seeded content into a session created before seeding', async () => {
    // The session predates any shared content, so create() linked nothing.
    // Opening it again (the touch() that openSession performs) must pick the
    // seeded content up.
    const store = createSessionStore(root);
    await store.create('set');
    await expect(store.list()).resolves.toBeDefined(); // seeds the root
    await store.touch('set');
    await expect(readFile(join(root, 'set', 'AGENTS.md'), 'utf8')).resolves.toBe(DEFAULT_AGENTS_MD);
    await expect(readFile(join(root, 'set', '.claude', 'skills', 'edit-live-beat', 'SKILL.md'), 'utf8')).resolves.toBe(
      DEFAULT_SKILLS['edit-live-beat']!,
    );
  });
});

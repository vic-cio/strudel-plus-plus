import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Default shared harness content for a sessions root.
 *
 * A sessions root is a user folder, so the app ships it no content — but a
 * fresh root leaves every session, and the harnesses spawned inside them,
 * with no context and no skills at all. When the root lacks them, these
 * defaults are seeded once; the write-to-file loop and the live snapshot they
 * describe are the app's real contract with a coding agent.
 *
 * The never-overwrite contract is the same as linkSharedPath's: an entry that
 * already exists is the user's, whatever it holds, and stays exactly as it is.
 */

export const DEFAULT_AGENTS_MD = `# strudel++ session context

You are a coding helper running inside the strudel++ desktop app, a Strudel
live-coding environment. This folder holds sessions; each subfolder is one
session of beat files, and the app has opened one of them. Your working
directory is that active session, so every path below is relative to it. The
app can also spawn helpers like you in this folder over a terminal pane.

## Beats

- A beat is a plain \`.js\` file holding a Strudel pattern. Beats may live in
  subfolders (for example \`drums/intro.js\`). A new session starts with one
  \`untitled.js\` starter beat.
- The live beat is the one open in the app's editor. Find its name in the
  \`beat\` field of \`.session.json\` in this folder.

## Editing live

- The app watches beat files. When its editor buffer has no unsaved edits and
  audio is playing, a write to the live beat is adopted into the editor and
  re-evaluated automatically — writing the beat file is the live-coding
  interface.
- If the editor buffer has unsaved edits, the app shows a conflict bar and
  the human chooses; the write is not silently applied or discarded.
- If audio is not playing, the edit shows in the editor but is not heard
  until the human starts playback (Ctrl+. or the play button).
- Make one coherent change per write and keep the file parseable JavaScript
  at every step, so the human can hear what moved.

## Tempo

- \`setcps(...)\` or \`setcpm(...)\` in a beat owns that beat's tempo.
- Otherwise the tempo control (bpm in the app's header) is remembered per
  beat in \`.session.json\` under \`cpsByBeat\`.

## Live and session state

- \`.session.json\` holds the session's state: the active \`beat\`, the
  remembered \`cpsByBeat\` tempo map, and the beat list sort (\`beatSort\`:
  \`chronological\`, \`alphabetical\`, or \`manual\`, plus \`manualBeatOrder\`).
- \`.strudel-live.json\` is rewritten continuously while the app runs (every
  500 ms while playing, every 2 s otherwise). It reports \`playing\`, \`cps\`,
  the open \`beat\`, \`unsavedEdits\`, the editor \`buffer\`, and audio meters.
  Read it fresh and check \`updated\`; do not cache it.
- The app's beat list can be sorted by recency, name, or a manual drag order
  (\`beatSort\` and \`manualBeatOrder\` in \`.session.json\`); sessions are
  listed by when they were last used.

## Audio and bridges

- Audio runs on StrudelMirror's WebAudio engine in the app's renderer, which
  is served over loopback HTTP (required for AudioWorklet and samples).
- The meters in \`.strudel-live.json\`: \`audio.master\` and
  \`audio.channels\` each carry \`rms\` and \`peak\` (0–1, gain scale) and
  \`low\`, \`mid\`, \`high\` band energy in dB (below 250 Hz, below 4 kHz,
  above). The master bus appears once audio has started; a named channel
  appears only after a pattern calls \`.analyze("name")\`.
- MIDI out goes through the app's main process via RtMidi. macOS has no MIDI
  port by default: enable the IAC Driver in Audio MIDI Setup to get one.
- OSC out sends \`/dirt/play\` bundles to \`127.0.0.1:57120\` by default.

## Skills

Shared skills for working here live in \`.claude/skills/\` and
\`.agents/skills/\` (the same set, for different harnesses). Start with
\`edit-live-beat\` when asked to change the music, and \`live-audio-state\`
when asked how it sounds.
`;

/**
 * Two skills, the ones a helper actually needs here: how to change the music
 * through the live beat file, and how to observe the running app. Kept small
 * on purpose; prose that restates this file is filler.
 */
export const DEFAULT_SKILLS: Record<string, string> = {
  'edit-live-beat': `---
name: edit-live-beat
description: Edit the beat file that is live in the strudel++ app so the change reaches the running audio. Use when asked to change, fix, or extend the music currently playing or on screen.
---

# Edit the live beat

1. Read \`.session.json\` in this folder. Its \`beat\` field names the beat
   open in the app's editor — that exact file is the one to edit. Beats are
   \`.js\` files here, possibly in subfolders.
2. Edit that file with a small, coherent change, keeping it parseable
   JavaScript. One change per write.

## How a write becomes sound

- The app watches beat files. With no unsaved edits in its editor buffer and
  audio running, your write is adopted into the editor and re-evaluated
  within a moment. The write-to-file loop is the live-coding interface.
- With unsaved edits in the buffer, the app raises a conflict bar and the
  human decides — never assume a write was applied in that case. Re-read
  \`.strudel-live.json\` afterwards: its \`buffer\` shows what the editor
  now holds and \`updated\` shows freshness.
- With audio stopped, the write shows in the editor but nothing sounds until
  the human starts playback (Ctrl+. or the play button).

## Conventions

- Leave \`setcps\`/\`setcpm\` lines alone unless tempo is the request; a
  beat that declares its own tempo ignores the app's tempo control.
- Do not reformat or rewrite the whole file to make a small change.
- If \`.session.json\` has no \`beat\` field, nothing is open yet; ask the
  human which beat to work on instead of guessing.
`,
  'live-audio-state': `---
name: live-audio-state
description: Read the strudel++ app's live state — audio meters (levels and EQ bands), playing status, tempo, and session state. Use when asked how it sounds, whether audio is playing, what is running, or to check app or session state.
---

# Observe live audio and session state

The app continuously rewrites \`.strudel-live.json\` in this folder (every
500 ms while playing, every 2 s otherwise). Read it fresh each time and check
\`updated\` for staleness; it only exists while the app is running.

What it holds:

- \`playing\`, \`cps\`, \`beat\` (open in the editor), \`unsavedEdits\`,
  \`updated\`.
- \`buffer\`: the editor's current contents. With \`unsavedEdits\` true it
  is ahead of the beat file on disk.
- \`audio.master\` and \`audio.channels\`: per-bus meters. \`rms\` and
  \`peak\` are 0–1 loudness on the gain scale; \`low\`, \`mid\`, \`high\`
  are band energy in dB (below 250 Hz, below 4 kHz, above). The master bus
  appears once audio has started; a named channel appears only after a
  pattern calls \`.analyze("name")\`.

Session state lives in \`.session.json\`: the active \`beat\`, the
remembered per-beat tempo map \`cpsByBeat\`, and the beat sort
(\`beatSort\`, \`manualBeatOrder\`). A \`setcps\`/\`setcpm\` call in a beat
overrides the remembered tempo for that beat.
`,
};

const SKILL_ROOTS = ['.claude', '.agents'] as const;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function seedSkills(root: string, dir: string): Promise<void> {
  const full = join(root, dir);
  // An existing .claude/.agents is the user's; do not add anything inside it.
  if (await exists(full)) {
    return;
  }
  for (const [name, content] of Object.entries(DEFAULT_SKILLS)) {
    const skillPath = join(full, 'skills', name, 'SKILL.md');
    if (await exists(skillPath)) {
      continue;
    }
    await mkdir(join(full, 'skills', name), { recursive: true });
    await writeFile(skillPath, content, 'utf8');
  }
}

/**
 * Seed the default shared harness content into a sessions root.
 *
 * Idempotent and non-destructive: each entry is written only when absent, so
 * a root the user has furnished is left exactly as it is. Failures are
 * swallowed like linkSharedPath's — shared harness content is a convenience,
 * never a reason to refuse to open.
 */
export async function seedHarnessContent(root: string): Promise<void> {
  try {
    if (!(await exists(join(root, 'AGENTS.md')))) {
      await writeFile(join(root, 'AGENTS.md'), DEFAULT_AGENTS_MD, 'utf8');
    }
    for (const dir of SKILL_ROOTS) {
      await seedSkills(root, dir);
    }
  } catch {
    // Seeding is a convenience. A root it could not reach still works.
  }
}

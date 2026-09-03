# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Independent wrapper boundary

- `app/package.json`, `UPSTREAM-SOURCES.md`, and `scripts/fetch-upstream-artifacts.mjs` are the authoritative dependency boundary: published `@strudel/*` packages are installed normally, while the small unpublished compatibility set is fetched by pinned commit and checksum into ignored `app/.external/`.
- Run `pnpm verify:boundary` after dependency or packaging changes; it checks that omitted upstream trees are absent and that wrapper code has no local-monorepo coupling.
- `pnpm build` is the macOS packaging path and includes the Electron identity check. It intentionally sets `npmRebuild: false` because the wrapper uses the tested native prebuilds for Electron packaging.

## Patched dependencies (pnpm patch)

- `patches/` holds pnpm patches for published npm packages with real bugs upstream hasn't fixed yet. The installed pnpm (9.12.2) only honors `patchedDependencies` in the root `package.json`'s legacy `pnpm` field — despite warning that the field is ignored, and despite `pnpm-workspace.yaml` being the documented new home for it, moving the entry there silently drops the patch (`node_modules/.pnpm/<pkg>@<version>/` stays unpatched with no error). Add new entries to `package.json`, then confirm with `ls node_modules/.pnpm/ | grep <pkg>` that a `_patch_hash=` directory exists before trusting it applied.
- `patches/superdough@1.3.0.patch` fixes `waveformN`, the custom-waveform oscillator builder for `sawtooth`/`square`/`triangle`/`user` synths (not the GM soundfont sample path — that never calls `createPeriodicWave`). Any `n`/`partials` value strictly between 0 and 1 is truthy but `new Float32Array(0.5)` truncates to length 0, so it reached `createPeriodicWave` with a 1-length real/imag pair and threw `The length of the real array provided (1) is less than 2` instead of falling back to a plain waveform. Pinned by `app/src/renderer/superdoughPatch.test.ts`, which needs `superdough` as an explicit `app` devDependency since `@strudel/webaudio`'s bundle re-exports only the names it uses itself.

## Native harness spawn (node-pty)

- node-pty 1.1.0's npm tarball ships `prebuilds/darwin-*/spawn-helper` without the executable bit; node-pty posix_spawns that helper on macOS, so every harness start dies with the misleading `posix_spawnp failed.` regardless of PATH (upstream fixed the tarball mode only in 1.2.0 betas). Three safeguards exist: `scripts/ensure-pty-helper.mjs` (app `postinstall`, repairs node_modules before packaging), `ensurePtyHelper` in `app/src/main/ptyHelper.ts` (repairs the unpacked copy at every launch), and a helper-executable assertion in `app/scripts/verify-native-identity.mjs`. Keep all three when touching packaging; drop them once node-pty is pinned to a release with the fix.
- Harness discovery resolves commands on the login shell's PATH widened with well-known install locations (`augmentPath` in `app/src/main/env.ts`), and `app/src/main/pty.ts` spawns the resolved absolute path, so launches from Finder with a bare PATH work. A command that cannot be resolved fails the start with an error naming the harness instead of a raw spawn error.

## Session state and the live-beat pointer

- `.session.json` is the contract harnesses read to find the live beat: its `beat` field must mirror what the EDIT buffer shows at all times. The renderer persists it at the events that move the buffer (`persistBeat` in `app/src/renderer/App.tsx`, called from adopt/rename/remove/openSession), not in a render effect — render-scheduled writes can be skipped or run with a stale beat. `SessionState.beat` is `string | null`; an explicit null records that nothing is open.
- Renderer-only draft state lives in `app/src/renderer/draftState.ts`: each session has `drafts`, `saved`, and `conflicts` maps keyed by beat name. Beat switching restores `drafts`; only explicit save updates `saved`; the maps are intentionally absent from `.session.json` and `.strudel-live.json`, and the close guard uses `hasDirtyDrafts` across all sessions.
- Keep `openSession`'s post-fetch mutation block free of awaits: it was once guarded by a hydration flag across awaits, and a mid-open failure blocked all session-state writes for the rest of the run, freezing the pointer on a long-gone beat — the stale answer a spawned agent then edited.
- The session store prunes `cpsByBeat` and `manualBeatOrder` entries whose beat file no longer exists, on load (`getState`) and write (`setState`) in `app/src/main/sessions.ts`. New per-beat state fields belong in that prune; tests pin all of this.

## Error surfaces: where failures may land

- Pattern parse/eval failures are the editor's own state (`useStrudel`'s `state.error`, shown in the status bar); they must never escape as unhandled exceptions. `useStrudel`'s `report` helper is the single sink for that: its `evaluate`/`toggle`/`reevaluate` wrappers catch rejections upstream lets through, and a `strudel.log` DOM listener catches scheduler-cycle errors upstream only logs, deduping repeats by message. The disk-change apply path (`applyDiskChange` in `app/src/renderer/App.tsx`) additionally guards `setCode`/`reevaluate` and routes unexpected throws to `setBeatError` (the tree error surface). The status bar's error slot has no intrinsic width limit — it must stay a shrinkable/ellipsizing flex child under a clamped `.app` grid column (`app/src/renderer/theme.css`), never an unbounded one, or a long message pushes fixed-width siblings like the harness pane off-window.
- `reportErrors.ts` funnels renderer failures to console AND to subscribers (`onRendererError`), which App surfaces. Its exported `reportError(reason, source)` is the single sink; the global `unhandledrejection`/`error` window listeners installed by `reportErrors()` call it, and so does any in-renderer catch that swallows an exception to keep running (e.g. the EQ's self-healing `requestAnimationFrame` loop in `plugins/eq.tsx`, which dedupes by message so a repeating per-frame failure reports once). `reportErrors()` itself is idempotent because the window listeners are global state. Main logs `render-process-gone`/`unresponsive` on the window — a renderer death otherwise leaves no trace anywhere.
- A stale REPL error must be dropped when the buffer moves to other content (`clearError` in `useStrudel`, called from `adopt` and the apply path): stopped playback means no re-evaluation will refresh it.
- A blocked or failed sound fetch otherwise resolves to silence with no visible error: a rejected `onTrigger` (e.g. a soundfont fetch) is already caught by upstream's `getTrigger` and reaches the `strudel.log` sink above, but the thrown message may not name the sound. `prebake.mjs`'s `nameSoundfontLoadErrors` re-wraps each `gm_*` trigger so the message names the instrument as typed in the pattern (e.g. `s("gm_pad_halo")`) before it reaches that sink.
- `app/src/renderer/index.html`'s CSP `default-src` must list every host the app fetches from at runtime — `@strudel/soundfonts` fetches font data from `felixroos.github.io` (see above) and `strudel.b-cdn.net` serves the default sample banks (`prebake.mjs`); a missing host fails those fetches silently rather than throwing a visible error, since fetch rejections from a CSP block still flow through the same sink. `csp.test.ts` pins the required hosts.

## Master audio tap selection

- `installMasterTap` (`app/src/renderer/masterTap.ts`) taps every `AudioContext` that ever connects a node to its `.destination`, keyed by context, in a `Map` (`installTap.ts`'s `masterTaps`). An `OfflineAudioContext.destination` is still an `AudioDestinationNode`, so an offline render — superdough generating a reverb impulse response off `.room()`/`.size()`, or a `.render()` bounce — also gets tapped; that context finishes and closes within milliseconds. `installTap.ts`'s `isDestination` therefore excludes `OfflineAudioContext` targets, so only contexts that actually reach the speakers get a tap.
- `masterAnalyser()` (read by both `plugins/eq.tsx` and `liveSnapshot.ts`) calls `selectLiveTap`, which prefers a `running` context's tap, prunes `closed` entries out of the map on sight, and opportunistically resumes a `suspended` one. A closed context's analyser freezes on its last rendered frame forever — if a second tap ever gets inserted after the live one (any future ephemeral-context leak), picking "whatever was inserted last" would permanently prefer the dead tap over the live one, which reads as a frozen EQ that survives even a full component remount.

## Default example session

- A brand-new sessions root (no session folder yet) is seeded with one example session, `we cook`, the moment anything calls `list()` — see `seedDefaultSession` in `app/src/main/sessions.ts`, alongside `seedHarnessContent`. It never touches a root that already has a session. The snapshot's files live under `app/default-session/` and are pulled in at build time via Vite `?raw`/JSON imports in `app/src/main/defaultSession.ts`, the same inlining approach `harnessContent.ts` uses for its defaults — no extra packaging step needed. `defaultSession.ts` strips the snapshot's `usedAt`; seeding always stamps its own via `nextUsedAt`.
- The canonical default root and legacy-root migration live in `app/src/main/sessionsRoot.ts`; the migration is independently exercised by `sessionsRoot.test.ts`.

## Beat watcher ignore rule

`watchBeats` skips dot-entries _relative to the watched root only_ (`ignored` in `app/src/main/watcher.ts`). Filtering on absolute path parts would silently deafen any sessions root under a dot-directory (e.g. worktrees like `.treehouse`), with no error anywhere. `watcher.test.ts` pins both sides of this rule.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

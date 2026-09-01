# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Independent wrapper boundary

- `app/package.json`, `UPSTREAM-SOURCES.md`, and `scripts/fetch-upstream-artifacts.mjs` are the authoritative dependency boundary: published `@strudel/*` packages are installed normally, while the small unpublished compatibility set is fetched by pinned commit and checksum into ignored `app/.external/`.
- Run `pnpm verify:boundary` after dependency or packaging changes; it checks that omitted upstream trees are absent and that wrapper code has no local-monorepo coupling.
- `pnpm build` is the macOS packaging path and includes the Electron identity check. It intentionally sets `npmRebuild: false` because the wrapper uses the tested native prebuilds for Electron packaging.

## Native harness spawn (node-pty)

- node-pty 1.1.0's npm tarball ships `prebuilds/darwin-*/spawn-helper` without the executable bit; node-pty posix_spawns that helper on macOS, so every harness start dies with the misleading `posix_spawnp failed.` regardless of PATH (upstream fixed the tarball mode only in 1.2.0 betas). Three safeguards exist: `scripts/ensure-pty-helper.mjs` (app `postinstall`, repairs node_modules before packaging), `ensurePtyHelper` in `app/src/main/ptyHelper.ts` (repairs the unpacked copy at every launch), and a helper-executable assertion in `app/scripts/verify-native-identity.mjs`. Keep all three when touching packaging; drop them once node-pty is pinned to a release with the fix.
- Harness discovery resolves commands on the login shell's PATH widened with well-known install locations (`augmentPath` in `app/src/main/env.ts`), and `app/src/main/pty.ts` spawns the resolved absolute path, so launches from Finder with a bare PATH work. A command that cannot be resolved fails the start with an error naming the harness instead of a raw spawn error.

## Session state and the live-beat pointer

- `.session.json` is the contract harnesses read to find the live beat: its `beat` field must mirror what the EDIT buffer shows at all times. The renderer persists it at the events that move the buffer (`persistBeat` in `app/src/renderer/App.tsx`, called from adopt/rename/remove/openSession), not in a render effect — render-scheduled writes can be skipped or run with a stale beat. `SessionState.beat` is `string | null`; an explicit null records that nothing is open.
- Keep `openSession`'s post-fetch mutation block free of awaits: it was once guarded by a hydration flag across awaits, and a mid-open failure blocked all session-state writes for the rest of the run, freezing the pointer on a long-gone beat — the stale answer a spawned agent then edited.
- The session store prunes `cpsByBeat` and `manualBeatOrder` entries whose beat file no longer exists, on load (`getState`) and write (`setState`) in `app/src/main/sessions.ts`. New per-beat state fields belong in that prune; tests pin all of this.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

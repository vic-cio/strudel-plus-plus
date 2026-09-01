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

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

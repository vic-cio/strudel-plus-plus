# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Independent wrapper boundary

- `app/package.json`, `UPSTREAM-SOURCES.md`, and `scripts/fetch-upstream-artifacts.mjs` are the authoritative dependency boundary: published `@strudel/*` packages are installed normally, while the small unpublished compatibility set is fetched by pinned commit and checksum into ignored `app/.external/`.
- Run `pnpm verify:boundary` after dependency or packaging changes; it checks that omitted upstream trees are absent and that wrapper code has no local-monorepo coupling.
- `pnpm build` is the macOS packaging path and includes the Electron identity check. It intentionally sets `npmRebuild: false` because the wrapper uses the tested native prebuilds for Electron packaging.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

# Contributing to strudel++

This repository is for one independent personal Electron wrapper. It is not a
mirror or fork of the upstream Strudel monorepo. Keep the maintained surface in
`app/`, the root build scripts, and the wrapper documentation and notices.

## Development

Use Node.js 18 or newer and pnpm 9.12.2:

```sh
pnpm install
pnpm check
pnpm build
```

`pnpm check` runs formatting, lint, focused tests, typecheck, and the tracked
wrapper-boundary scan. `pnpm build` is macOS-only because it packages and
inspects a macOS Electron bundle.

## Dependency boundary

Strudel runtime packages are exact npm versions in `app/package.json`; do not
replace them with `workspace:*` links or relative imports. Three current
upstream modules are not published at the versions used by the wrapper. The
build fetches only the individually pinned files listed in
`UPSTREAM-SOURCES.md`, verifies their checksums, and places them in the ignored
`app/.external/` cache. Update that manifest and its checksums together with a
deliberate compatibility review if the upstream release changes.

Do not reintroduce upstream `packages/`, website, Tauri, examples, or docs
trees. If a wrapper feature needs upstream behavior, use a published package or
an explicitly documented external build input rather than copying a monorepo
tree into this repository.

## Licensing and attribution

The project is AGPL-3.0-or-later. Preserve `LICENSE`,
`THIRD-PARTY-NOTICES.md`, the upstream source manifest, and the source notices
when changing or packaging the app. This document describes project practice;
the license and upstream terms control.

## Pull requests

Describe behavior changes and the validation commands you ran. Do not create or
push to the planned public remote as part of local development; Firstmate owns
that handoff after the candidate is ready.

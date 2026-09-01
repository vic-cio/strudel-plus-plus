# strudel++

An independent personal macOS desktop wrapper for live coding with Strudel.
It adds file-backed beat sessions, an editor-side coding harness, and native
MIDI/OSC bridges to an Electron desktop window.

This is an independent project, not the upstream Strudel repository and not an
official Strudel distribution. It deliberately has fresh history and does not
contain a copy of the upstream monorepo. The upstream project is maintained at
<https://codeberg.org/uzu/strudel>; its code and contributors are credited in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Setup

Requirements: macOS, Node.js 18 or newer, and pnpm 9.12.2.

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

`pnpm build` creates and validates `app/release/mac-arm64/strudel++.app`.
The packaging step is macOS-specific. For an unpackaged development window:

```sh
pnpm dev
```

The app build fetches three current upstream modules that are not published to
npm (`@strudel/edo`, `@strudel/dough`, and the current Tidal adapter). The
fetch is pinned to one upstream commit, downloads only the eight required module
files, verifies SHA-256 checksums, and stores them under the ignored
`app/.external/` build cache. See [UPSTREAM-SOURCES.md](UPSTREAM-SOURCES.md).

## Scope

The wrapper lives under [`app/`](app/). Its source, focused tests, Electron
configuration, native identity check, icon assets, and harness definition are
the maintained project surface. The app imports published Strudel packages at
exact versions and retains the audio engine, editor, visual helpers, soundfonts,
MIDI, OSC, Hydra, Mondo, Tidal, EDO, and Dough features used by the current
wrapper.

Beat sessions are user data and are intentionally not part of this repository.
See [`app/README.md`](app/README.md) for session, harness, tempo, MIDI, OSC, and
debugging details.

## Licensing and provenance

This project is licensed under [AGPL-3.0-or-later](LICENSE). The wrapper is a
combined work with AGPL-licensed upstream Strudel modules and other runtime
dependencies; preserve the notices and corresponding-source information when
redistributing it. This repository is an implementation and provenance
inventory, not legal advice.

[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) records upstream attribution,
dependency licenses, and the remote sample banks loaded by the app. The sample
indexes and audio remain remote; the app does not claim ownership of those
sample collections.

## Contributing

Keep changes within the wrapper boundary. Do not add upstream monorepo source,
workspace links, or generated build output. Run `pnpm check` before proposing a
change. See [CONTRIBUTING.md](CONTRIBUTING.md).

The repository lives at <https://github.com/vic-cio/strudel-plus-plus>; this
source is what is published there. Propose changes with a normal pull request
following [CONTRIBUTING.md](CONTRIBUTING.md).

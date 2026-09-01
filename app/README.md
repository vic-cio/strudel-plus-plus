# strudel++ desktop wrapper

This directory contains the Electron desktop wrapper maintained by this
project. The wrapper is independent from the upstream Strudel monorepo; its
dependency boundary is the exact published package set plus the pinned,
package-only build inputs described in [`../UPSTREAM-SOURCES.md`](../UPSTREAM-SOURCES.md).

## Commands

Run these from the repository root:

```sh
pnpm install
pnpm dev                 # Electron window with hot reload
pnpm test                # focused wrapper tests
pnpm typecheck
pnpm build               # macOS unpacked app and identity validation
pnpm dist                # macOS distributable and identity validation
```

The equivalent app-local commands are `pnpm --dir app <command>`. Build and
development first fetch the pinned external modules into the ignored
`app/.external/` cache. Tests use a local empty module only for mocks and do
not hide a production dependency.

The macOS build verifies the generated bundle's filename, `Info.plist`,
executable, packaged renderer, and icon. To inspect an existing bundle:

```sh
pnpm --dir app run verify:identity -- release/mac-arm64/strudel++.app
```

`node-pty` and `@julusian/midi` are native modules. Packaging keeps their
platform prebuilds from npm (`@julusian/midi` uses N-API); this avoids a
machine-specific node-gyp rebuild and is recorded as `npmRebuild: false` in the
Electron-builder metadata. If a native prebuild is unavailable after an
Electron upgrade, run `pnpm --dir app exec electron-rebuild -f` and rebuild the
app.

## Sessions and harnesses

The app opens one session folder at a time. By default it uses
`my-sessions/`, or the directory named by `STRUDEL_BEATS_DIR`; session data is
ignored by Git. Each session contains beat `.js` files, an `AGENTS.md` context
file, optional shared helper links, and `.session.json` state.

The sidebar supports newest-first, name A–Z, and per-session manual ordering.
Sorting and remembered per-beat tempo values live in `.session.json`.

`harnesses.json` defines the coding helpers shown in the pane. Each helper runs
in a fresh pty rooted at the selected session. The login-shell PATH is used so
commands installed in `~/.local/bin` are available when Electron is launched
from Finder. Every helper is prompted to read the session `AGENTS.md` first.

When a helper writes the active beat, the watcher updates a clean editor buffer;
if the buffer is dirty, the conflict bar lets you keep the local buffer or take
the disk version. A file write is not an audio evaluation: use Ctrl+Enter to
apply the current editor buffer.

## Tempo, audio, MIDI, and OSC

`setcps(...)` and `setcpm(...)` in a beat own that beat's tempo. Otherwise the
menubar value is remembered per beat. The scheduler's running value is shown by
the tempo control.

The renderer is served over loopback HTTP in development and release. This is
needed for AudioWorklet module loading and remote sample fetches; `file://`
would leave the app silent.

MIDI and OSC run through the Electron main process rather than browser APIs.
MIDI sends through RtMidi, while OSC sends `/dirt/play` bundles to
`127.0.0.1:57120` by default. macOS has no MIDI port by default: enable the IAC
Driver in Audio MIDI Setup, then inspect ports with
`window.desktop.midi.ports()` from a harness or dev console.

## Layout and debugging

```text
src/main/       Electron main process: window, sessions, watcher, pty, MIDI, OSC
src/preload/    The IPC surface exposed to the renderer
src/shared/     Pure wrapper logic and unit tests
src/renderer/   React UI, StrudelMirror, xterm, audio bridges
```

For a capture during development:

```sh
STRUDEL_CAPTURE=/tmp/strudel-plus-plus.png pnpm dev
```

The capture can show a stale frame if another macOS window occludes Electron;
the main-process log includes the window id for `screencapture -l`.

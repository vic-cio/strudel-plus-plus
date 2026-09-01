# Third-party notices and provenance

This file is an inventory for the independent `strudel++` desktop wrapper. It
is not legal advice. Keep it with the source and any redistribution, and read
the cited project licenses for their complete terms.

## Strudel upstream

The wrapper is built around Strudel, an open-source live-coding project by its
contributors. The upstream project is maintained at
<https://codeberg.org/uzu/strudel> and is licensed under AGPL-3.0-or-later.
Published modules are pinned in `app/package.json`; the unpublished current
module entry points are listed with checksums in
[UPSTREAM-SOURCES.md](UPSTREAM-SOURCES.md). The wrapper adaptations in
`app/src/renderer/midiBridge.mjs`, `app/src/renderer/oscBridge.mjs`, and
`app/src/renderer/prebake.mjs` retain their upstream relationship in their
source comments. The wrapper-owned `minimalOutput.mjs` helper is a compatibility
adapter for the current unpublished Dough entry point; the fetch script applies
that adapter without changing the verified upstream bytes.

The complete AGPL-3.0-or-later text is in [LICENSE](LICENSE). Corresponding
upstream source is available from the pinned commit and through the fetch
script, without importing the upstream monorepo into this repository.

## Runtime and build dependencies

The following direct dependencies are used by the wrapper. Package metadata and
the lockfile identify their exact versions and transitive dependencies.

| Dependency                           |        Version | License           | Project                                  |
| ------------------------------------ | -------------: | ----------------- | ---------------------------------------- |
| `@julusian/midi`                     |          3.8.1 | MIT               | <https://github.com/Julusian/node-midi>  |
| `node-pty`                           |          1.1.0 | MIT               | <https://github.com/microsoft/node-pty>  |
| `dough-synth`                        |          0.2.4 | AGPL-3.0-or-later | <https://codeberg.org/uzu/strudel>       |
| `hs2js`                              |          0.1.0 | AGPL-3.0-or-later | <https://github.com/tidalcycles/strudel> |
| `hydra-synth`                        |         1.3.29 | AGPL              | <https://github.com/ojack/hydra-synth>   |
| `mondolang`                          |          1.1.2 | AGPL-3.0-or-later | <https://github.com/tidalcycles/strudel> |
| `superdough`                         |          1.3.0 | AGPL-3.0-or-later | <https://codeberg.org/uzu/strudel>       |
| `supradough`                         |          1.2.4 | AGPL-3.0-or-later | <https://codeberg.org/uzu/strudel>       |
| `sfumato`                            |          0.1.2 | ISC               | <https://codeberg.org/froos/sfumato>     |
| `react` / `react-dom`                |         19.0.0 | MIT               | <https://react.dev/>                     |
| Electron                             |         34.5.8 | MIT               | <https://github.com/electron/electron>   |
| `electron-builder` / `electron-vite` | 25.1.8 / 3.1.0 | MIT               | Their upstream project pages             |
| `@xterm/xterm` / `@xterm/addon-fit`  | 5.5.0 / 0.10.0 | MIT               | <https://github.com/xtermjs/xterm.js>    |
| `chokidar` / `worker-timers`         | 4.0.3 / 8.0.13 | MIT               | Their upstream project pages             |
| `vite-plugin-bundle-audioworklet`    |          0.1.2 | MIT               | <https://codeberg.org/uzu/strudel>       |

The CodeMirror, Testing Library, TypeScript, Vite, jsdom, and other development
packages are pinned in `app/package.json` and `pnpm-lock.yaml`; their package
licenses remain in their installed package metadata when a dependency is
redistributed.

## Remote sample banks

The app does not vendor audio samples. `app/src/renderer/prebake.mjs` loads
sample indexes and files at runtime from `https://strudel.b-cdn.net`, including:

- `piano.json` and `piano/`
- `vcsl.json` and `VCSL/`
- `tidal-drum-machines.json` and `tidal-drum-machines/machines/`
- `uzu-drumkit.json`, `uzu-drumkit/`, and `tidal-drum-machines-alias.json`
- `uzu-wavetables.json` and `mridangam.json` / `mrid/`
- the `Dirt-Samples/` collection used by the additional named banks

For the default sound-bank licensing and provenance, see the upstream
[`dough-samples` documentation](https://github.com/felixroos/dough-samples/blob/main/README.md).
The remote collections are third-party material; this wrapper does not claim
ownership of them and does not make a local redistribution of their contents.

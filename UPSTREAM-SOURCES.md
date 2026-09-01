# Upstream build inputs

The wrapper uses the published Strudel packages listed below at exact versions.
At the time this candidate was prepared, the current upstream versions of
`@strudel/edo`, `@strudel/dough`, and `@strudel/tidal` were not all available as
published npm packages. Their small package entry points are therefore an
explicit external build input rather than copied repository content.

The build script fetches these eight files from the upstream Strudel source at
commit [`8f81463b9cb5ddd5f117ed7baef6a1fde9445dc2`](https://codeberg.org/uzu/strudel/commit/8f81463b9cb5ddd5f117ed7baef6a1fde9445dc2), verifies each SHA-256 digest,
and writes them only to the ignored `app/.external/strudel/` cache. It does not
clone or archive the upstream repository, and no fetched file is tracked here.

| Build module     | Upstream file                | SHA-256                                                            |
| ---------------- | ---------------------------- | ------------------------------------------------------------------ |
| `@strudel/edo`   | `packages/edo/index.mjs`     | `10c2cbbf1a61ebd902c467a39c632983d776f45db1f93459b20bfc49a1394d62` |
| `@strudel/edo`   | `packages/edo/edo.mjs`       | `8600a9c7b72ac85be0c285f535d3b57ec8c97a1d73050f55283375a4ac810011` |
| `@strudel/edo`   | `packages/edo/edoscale.mjs`  | `7c59f9f8eb7da5fcf1aa10bb5a717b119d9790ff64dc509288869cafaf03a72f` |
| `@strudel/edo`   | `packages/edo/intervals.mjs` | `47b7e83ec9427ec9c118b4b3696ea939a329d6a1bf2758a16adcea375b828723` |
| `@strudel/edo`   | `packages/edo/ratios.mjs`    | `23ba101a9d36ee6afda727b6889decb73a0dac928eb64cd0a76c71dc3b882f48` |
| `@strudel/edo`   | `packages/edo/pitches.mjs`   | `b323157ec47fcd439ccacfb34e19897507ac8b21a7a07c3757bfe82e70f58f1d` |
| `@strudel/dough` | `packages/dough/dough.mjs`   | `0982f0293cbe90dde566c6ba9f6345c63061a859fb791a17a33f4484ed184c0f` |
| `@strudel/tidal` | `packages/tidal/tidal.mjs`   | `1174047e456b06683a4f255217ddeda7aa6ab4657d1ba3ce967589bc30f9a81d` |

The external modules remain AGPL-licensed upstream code. Their corresponding
source is available at the pinned upstream commit and is reproducible with
`scripts/fetch-upstream-artifacts.mjs`; the attribution and license inventory
is in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

The fetched Dough entry point is adapted at build time to import the small
wrapper-owned `app/src/renderer/minimalOutput.mjs` helper. Published
`@strudel/webaudio` no longer exports the helper expected by this current
upstream entry point; the wrapper helper preserves its timing-keepalive signal
without changing the Dough feature or vendoring the source package.

## Published dependency boundary

The wrapper imports these exact published Strudel packages from npm:

```text
@strudel/core        1.2.6      @strudel/mini        1.2.6
@strudel/draw        1.2.6      @strudel/mondo       1.1.6
@strudel/hydra       1.2.6      @strudel/motion      1.2.6
@strudel/midi        1.3.0      @strudel/osc         1.3.2
@strudel/soundfonts  1.3.0      @strudel/tonal       1.2.6
@strudel/transpiler  1.2.6      @strudel/webaudio    1.3.0
@strudel/xen         1.2.6      @strudel/codemirror  1.3.0
```

The lockfile records the complete transitive dependency graph. `dough-synth`
0.2.4 and `hs2js` 0.1.0 are direct npm inputs for the two external adapters.

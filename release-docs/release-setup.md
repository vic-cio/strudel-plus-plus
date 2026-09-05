# Release setup and Apple Developer documentation

This file is durable project knowledge for the release/distribution path.
Keep it updated when secret names, identity names, or workflow behavior change.

## Architecture

This project builds `arm64` only (`mac-arm64`). The current native prebuilds for
`node-pty` 1.1.0 and `@julusian/midi` 3.8.1 are tested on Apple Silicon. A
future `x64` or universal (`universal`) artifact requires confirming both
prebuilds and the `npmRebuild: false` strategy work on Intel, which is not
verified today. Leave a follow-up note (`release-docs/release-setup.md`) rather than
pretending universal support exists.

## Artifact formats

- `dir` (`app/release/mac-arm64/strudel++.app`) — unpacked app used by `pnpm build`.
- `.dmg` and `.zip` — produced by `pnpm --dir app dist` (or the `release` workflow) for public distribution.
- `.zip` is the minimal artifact; `.dmg` is the standard consumer install format.

Both `.dmg` and `.zip` require the same signing/notarization path.

## Developer ID Application setup (one-time)

1. Apple Developer Program membership is required.
2. Create or import a `Developer ID Application` certificate in Keychain Access.
3. Note the exact identity string: `Developer ID Application: Name (TEAM_ID)`.
4. Generate an App-Specific Password at `appleid.apple.com` (not your Apple ID password).

## Required GitHub Actions secrets

These secrets are never committed. They must be configured in the repository settings (`Settings` → `Secrets and variables` → `Actions`) before the release workflow runs.

| Secret name                   | Purpose                                           |
| ----------------------------- | ------------------------------------------------- |
| `APPLE_ID`                    | Apple Developer email                             |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password                             |
| `APPLE_TEAM_ID`               | 10-character Apple Team ID                        |
| `DEVELOPER_ID_APP_IDENTITY`   | Identity string from step 3 above                 |
| `CSC_LINK`                    | Optional: base64-encoded `.p12` certificate file  |
| `CSC_KEY_PASSWORD`            | Optional: `.p12` password (if `CSC_LINK` is used) |

If `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` are missing,
the release workflow fails clearly (`Release secrets missing: ...`). If a
public release is triggered without these secrets, no unsigned `.dmg`/`.zip` is
uploaded.

## Dry-run vs public release

- **Dry-run** (`workflow_dispatch` with `dry_run: true`): builds unsigned `.dmg`/`.zip` artifacts without any Apple secrets. Use for maintainer testing of packaging only. Clearly separate from the publishing path.
- **Public release** (`push` to `v*` tag or `workflow_dispatch` without `dry_run`): requires all secrets above. The workflow verifies presence before building, generates `release/electron-builder.release.generated.yml` (from `release/electron-builder.release.yml` template) using `DEVELOPER_ID_APP_IDENTITY`, and calls `electron-builder` with that generated config.

## Gatekeeper expectations

A properly signed and notarized `.dmg`/`.zip` avoids the "cannot be opened because the developer cannot be verified" warning. If a user sees the warning, it means either:

- The artifact was built without `notarize: true` (dry-run), or
- Notarization failed (check Apple Developer account / team status), or
- Gatekeeper settings are set to "App Store and identified developers" but the build identity does not match.

The app does not support sandboxing or Mac App Store (`mas`) targets; it uses `dir`/`dmg`/`zip` only.

## Bundled runtime code

The packaged app must include all runtime Strudel code needed to function without asking the user to clone `strudel.cc` or install a separate package. The `scripts/verify-release-packaging.mjs` script verifies the presence of required `@strudel/*` modules in `app.asar.unpacked/node_modules` and checks the pinned upstream `app/.external/strudel/` files.

Remote samples (`strudel.b-cdn.net`) and soundfont data (`felixroos.github.io`) remain network-accessed; they are not vendored and are documented in `THIRD-PARTY-NOTICES.md`.

## Corresponding source

Upstream modules not published to npm (`@strudel/edo`, `@strudel/dough`, `@strudel/tidal`) are fetched from the pinned commit (`8f81463b...`) by `scripts/fetch-upstream-artifacts.mjs`, verified by SHA-256, stored in `app/.external/strudel/` (ignored by git), and included in the build through the Vite alias (`electron.vite.config.ts`). The complete source for these modules is available at the upstream commit URL; the wrapper does not copy the full upstream monorepo.

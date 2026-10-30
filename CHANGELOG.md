# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## Unreleased

### Fixed

- Variables read only in tooling files (`metro.config.js`, `scripts/` etc.) are no longer reported as unused.
- Build profiles without `environment` now use the environment EAS picks for them (`production` for `store` distribution, otherwise `development` for development clients and `preview`), so their `eas.json` `env` is checked too. They're reported once, as info, instead of one warning per profile.
- `EXPO_PUBLIC_` variables read in `app.config.*` are now checked. They were treated like Expo's own `EXPO_*` variables and skipped.
- Reads that already handle `undefined` (`X && …`, `X === 'true'`, `X ? a : b`, `if (X)`, `!X`) count as having a fallback, like `??` and `||`. The `APP_VARIANT === 'development'` pattern from the Expo docs is no longer flagged in `app.config.*`.
- `process['env'].EXPO_PUBLIC_X` is recognised. babel-preset-expo inlines it.
- Config plugins (`plugins/`), `e2e/`, `__mocks__/` and Jest/Vitest setup files are treated as Node-side tooling, not app code.
- EAS CLI is started once before environments are read in parallel, so a first `npx eas-cli` download doesn't race with itself.

### Added

- `dev-client-production-environment` warning: a development client profile with the default `store` distribution and no `environment` gets production variables.

## 0.1.2 - 2026-10-30

### Changed

- Published from GitHub Actions with npm provenance, through npm staged publishing (a maintainer approves each version with 2FA). The release workflow skips versions already on npm.

0.1.1 was never published to npm.

## 0.1.0 - 2026-10-30

### Added

- First version of the CLI and the `runDoctor()` API.
- Checks: variables missing per environment (local `.env*`, EAS environments, `eas.json` `env`), access patterns Expo can't inline, unprefixed variables in app code, secrets in `EXPO_PUBLIC_` variables, `app.config.*` variables missing per environment, `sensitive` `EXPO_PUBLIC_` variables on EAS, `eas.json` profiles without `environment`, unused variables, typo suggestions.
- Knows what EAS Build uploads: `.gitignore`, and a `.easignore` at the git root replacing it.
- `--offline`, `--environment`, `--ignore`, `--json`, `--strict`, `--version`.

# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## Unreleased

## 0.1.0 - 2026-10-30

### Added

- First version of the CLI and the `runDoctor()` API.
- Checks: variables missing per environment (local `.env*`, EAS environments, `eas.json` `env`), access patterns Expo can't inline, unprefixed variables in app code, secrets in `EXPO_PUBLIC_` variables, `app.config.*` variables missing per environment, `sensitive` `EXPO_PUBLIC_` variables on EAS, `eas.json` profiles without `environment`, unused variables, typo suggestions.
- Knows what EAS Build uploads: `.gitignore`, and a `.easignore` at the git root replacing it.
- `--offline`, `--environment`, `--ignore`, `--json`, `--strict`, `--version`.

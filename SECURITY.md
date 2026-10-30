# Security

## Reporting a vulnerability

Please don't open a public issue. Report it privately through [GitHub's private vulnerability reporting](https://github.com/gligor99/expo-env-doctor/security/advisories/new). The maintainer will reply as soon as possible.

## How the tool handles your values

expo-env-doctor reads environment variable values, including EAS `plaintext` and `sensitive` ones, so it can detect secrets in `EXPO_PUBLIC_` variables. It is designed to never leak them:

- Values are never printed, logged or written to the JSON output. A secret match shows only the first 4 characters and the length.
- Values pulled from EAS (`eas env:pull`) go to a private temp directory and are deleted right after parsing.
- EAS `secret` variables can't be read outside EAS servers. The tool only sees their names.
- The tool makes no network requests of its own. EAS access goes through EAS CLI and its login (or `EXPO_TOKEN`). If EAS CLI isn't installed, `npx` downloads it from npm.

If you find a way the tool exposes a value, please report it as a vulnerability.

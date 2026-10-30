# Contributing

Thanks for helping. Bug reports with a small reproduction are just as valuable as code.

## Setup

```sh
git clone git@github.com:gligor99/expo-env-doctor.git
cd expo-env-doctor
nvm use        # Node 22, see .nvmrc (the package supports Node >= 20.19)
npm install
npm test
```

Try your change against a real project:

```sh
npm run build
node dist/cli.js path/to/your/expo-app --offline
```

## Project layout

```
src/
  cli.ts              argument parsing, output, exit codes
  index.ts            runDoctor(): the public API
  model.ts            builds the ProjectModel: code accesses + environments
  checks.ts           every check, as a pure function ProjectModel → Finding[]
  report.ts           text and JSON output
  scan/files.ts       which files are scanned and how they're classified (app / config / server)
  scan/code.ts        AST scan of process.env reads (@babel/parser)
  sources/dotenv.ts   .env* files, read with Expo's own @expo/env
  sources/eas.ts      EAS environments via EAS CLI (behind the EasSource interface)
  sources/project.ts  eas.json, EAS project ID, what EAS Build uploads
test/                 Vitest, no network: EAS is always a fake EasSource
spikes/fixture-app/   real Expo app used to verify behaviour (see docs/spikes.md)
```

## Adding a check

1. Write a pure function in `src/checks.ts` that takes the `ProjectModel` and returns `Finding[]`, then add it to `runChecks`.
2. Give the finding a stable kebab-case `id`. Ids are part of the JSON output, so don't rename existing ones.
3. Every finding should explain **why** it breaks the app, and include a `fix` the user can copy.
4. Never put a variable's value in a message. Use `mask()` if you have to hint at it.
5. Add tests in `test/checks.test.ts` (unit) and, if the check reads files, in `test/doctor.test.ts` (end to end).
6. Add a row to the "What it checks" table in the README.

## Claims about Expo or EAS behaviour

This tool is only useful if its rules match what Expo and EAS really do. If a check depends on how Expo inlines variables, which `.env` files load, or what EAS uploads, verify it on a real project (`spikes/fixture-app`, `npx expo export`, `eas build:inspect`) and write down the result in `docs/spikes.md` with the Expo SDK and eas-cli versions you used.

## Before opening a PR

```sh
npm run format
npm run typecheck
npm test
```

CI runs the same steps on Node 20.19, 22 and 24, plus a smoke test of the built CLI.

- Keep PRs focused on one change.
- Add a line under `## Unreleased` in `CHANGELOG.md` for user-facing changes.

## Releasing (maintainers)

1. Move the `Unreleased` entries in `CHANGELOG.md` under the new version, and bump `version` in `package.json`.
2. Commit, then create a GitHub release with tag `vX.Y.Z`.
3. The `Release` workflow publishes to npm with provenance via npm trusted publishing (no token stored in the repo).

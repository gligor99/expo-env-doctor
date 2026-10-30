# expo-env-doctor

[![CI](https://github.com/gligor99/expo-env-doctor/actions/workflows/ci.yml/badge.svg)](https://github.com/gligor99/expo-env-doctor/actions/workflows/ci.yml)

Finds the environment variables your Expo app reads that will be `undefined` on a user's device, before you ship.

```sh
npx expo-env-doctor
```

```
Checked: local, eas:development, eas:preview, eas:production

ERROR  `EXPO_PUBLIC_API_URL` is destructured from process.env. Expo only inlines direct reads, so it is undefined in the app.
       src/api.ts:3
       fix: const EXPO_PUBLIC_API_URL = process.env.EXPO_PUBLIC_API_URL;

ERROR  EXPO_PUBLIC_SENTRY_DSN is used but not defined in eas:production. It is defined in .env.local, but EAS Build doesn't upload that file (gitignored or in .easignore).
       app/_layout.tsx:12
       fix: eas env:set --environment production --name EXPO_PUBLIC_SENTRY_DSN --value <value> --visibility plaintext
```

## Why

Expo replaces `process.env.EXPO_PUBLIC_*` with its value when the JS bundle is built. Anything it can't replace, or a variable that isn't defined where the build runs, silently becomes `undefined`. There's no build error and no warning, and the app breaks at runtime.

## What it checks

| Check | Severity |
|---|---|
| `EXPO_PUBLIC_*` used in the app but missing in an environment (local `.env*`, EAS development / preview / production, `eas.json` `env`) | error (warning for EAS development) |
| Read in a way Expo can't inline: destructuring, `const env = process.env`, `process.env[key]`, `process.env` as a whole | error |
| Variable without the `EXPO_PUBLIC_` prefix read in app code | error |
| Secret in an `EXPO_PUBLIC_` variable (secret-like name, or a value that looks like a Stripe/AWS/GitHub/OpenAI key, private key or Supabase `service_role` JWT) | error |
| Variable needed in a cloud build but only defined in a gitignored `.env` file | error (as a hint on the missing variable) |
| `app.config.*` reads a variable missing in an environment, with no fallback | warning |
| `EXPO_PUBLIC_` variable marked `sensitive` on EAS (it ships in plain text anyway) | warning |
| `eas.json` build profile without `environment` | warning |
| Variable defined but never read | warning |
| Typos: suggests a defined name within 2 characters | hint |

Values are never printed. Secret matches show only the first 4 characters and the length.

## Options

```
expo-env-doctor [projectDir]
  --environment <name>   Only check this EAS environment (repeatable)
  --offline              Skip EAS; check code against local .env files only
  --ignore <VAR>         Ignore findings for a variable (repeatable)
  --json                 Machine-readable output
  --strict               Exit with 1 on warnings too
```

Exit codes: `0` no errors, `1` errors found, `2` usage or runtime error.

## EAS

When the app config has an EAS project ID, the tool reads each EAS environment with your EAS CLI login (`eas env:pull` and `eas env:list`). In CI, set `EXPO_TOKEN`. A robot token with the Developer role is enough. Pulled values go to a private temp dir and are deleted right away. Use `--offline` to skip EAS.

## CI

```yaml
- run: npx expo-env-doctor --strict
  env:
    EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
```

## Development

```sh
npm install
npm test
npm run build
```

`spikes/fixture-app` is a real Expo app used to verify the inlining rules and EAS output formats; see `docs/spikes.md`.

## License

MIT

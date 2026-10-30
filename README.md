# expo-env-doctor

[![CI](https://github.com/gligor99/expo-env-doctor/actions/workflows/ci.yml/badge.svg)](https://github.com/gligor99/expo-env-doctor/actions/workflows/ci.yml)

Finds the environment variables your Expo app reads that will be `undefined` on a user's device, before you ship.

```sh
npx expo-env-doctor
```

Or add it to the project (Node >= 20.19):

```sh
npm install --save-dev expo-env-doctor
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

| Check                                                                                                                                                          | Severity                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `EXPO_PUBLIC_*` used in the app but missing in an environment (local `.env*`, EAS development / preview / production, `eas.json` `env`)                        | error (warning for EAS development)       |
| Read in a way Expo can't inline: destructuring, `const env = process.env`, `process.env[key]`, `process.env` as a whole                                        | error                                     |
| Variable without the `EXPO_PUBLIC_` prefix read in app code                                                                                                    | error                                     |
| Secret in an `EXPO_PUBLIC_` variable (secret-like name, or a value that looks like a Stripe/AWS/GitHub/OpenAI key, private key or Supabase `service_role` JWT) | error                                     |
| Variable needed in a cloud build but only defined in a gitignored `.env` file                                                                                  | error (as a hint on the missing variable) |
| `app.config.*` reads a variable missing in an environment, with no fallback                                                                                    | warning                                   |
| `EXPO_PUBLIC_` variable marked `sensitive` on EAS (it ships in plain text anyway)                                                                              | warning                                   |
| Development client build profile that gets the `production` EAS environment (no `environment`, default `store` distribution)                                   | warning                                   |
| `eas.json` build profiles without `environment` (lists the environment EAS picks for each)                                                                     | info                                      |
| Variable defined but never read (reads in `*.config.*` and `scripts/` count)                                                                                   | warning                                   |
| Typos: suggests a defined name within 2 characters                                                                                                             | hint                                      |

Values are never printed. Secret matches show only the first 4 characters and the length.

## Options

```
expo-env-doctor [projectDir]
  --environment <name>   Only check this EAS environment (repeatable)
  --offline              Skip EAS; check code against local .env files only
  --ignore <VAR>         Ignore findings for a variable (repeatable)
  --json                 Machine-readable output
  --strict               Exit with 1 on warnings too
  -v, --version          Show the version
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

## Node API

```ts
import { runDoctor } from 'expo-env-doctor';

const { environments, findings } = await runDoctor('/path/to/app', { offline: true });
```

`findings` has the same shape as the `--json` output: `{ id, severity, message, variable?, environments?, file?, line?, fix? }`. Finding ids are stable.

## Limitations

- Only `process.env` reads in your own source files are checked. Values read inside `node_modules`, native code or config plugins are not.
- An alias (`const env = process.env`) is reported, but reads through it aren't tracked by name.
- Projects outside git: the tool can't tell which `.env` files EAS Build uploads, so it assumes all of them are.
- Expo's inlining rules were verified on SDK 58 (see [docs/spikes.md](docs/spikes.md)). If a newer SDK behaves differently, please open an issue.

## Contributing

Bug reports and new checks are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)

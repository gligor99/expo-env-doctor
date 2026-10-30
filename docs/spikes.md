# Phase 0 — Spike results

Date: 2026-10-30. Fixture: `spikes/fixture-app` (Expo SDK 58, RN 0.88.1, eas-cli 27.2.0), linked to EAS project `@g99labs/expo-env-doctor-fixture` (ID `38241d4c-bb12-4689-b002-b21f5484073c`). All EAS values are fake.

## Spike 2 — Inlining rules ✅ done

Method: `envProbe.ts` reads each variable through a different access pattern. Each variable has a unique value in `.env`. Then `npx expo export --platform android --no-bytecode` and grep the bundle.

| Pattern                                         | Inlined? | In bundle                                                                                                                                           |
| ----------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `process.env.EXPO_PUBLIC_X`                     | ✅       | `"sentinel_dot"`                                                                                                                                    |
| `process.env['EXPO_PUBLIC_X']` (string literal) | ✅       | `"sentinel_bracket"`                                                                                                                                |
| `process.env?.EXPO_PUBLIC_X`                    | ✅       | `"sentinel_optional"`                                                                                                                               |
| `` `${process.env.EXPO_PUBLIC_X}` ``            | ✅       | `"sentinel_template"`                                                                                                                               |
| `const { EXPO_PUBLIC_X } = process.env`         | ❌       | `{EXPO_PUBLIC_DESTRUCT:n}=process.env`                                                                                                              |
| `const env = process.env; env.EXPO_PUBLIC_X`    | ❌       | `t.EXPO_PUBLIC_ALIAS`                                                                                                                               |
| `process.env[key]` (`key` is a const)           | ❌       | `process.env.EXPO_PUBLIC_DYNAMIC`. The minifier folds the constant **after** Babel has run, so the output _looks_ like dot access but isn't inlined |
| `JSON.stringify(process.env)`                   | ❌       | not inlined                                                                                                                                         |
| `process.env.PRIVATE_X` (no prefix)             | ❌       | `process.env.PRIVATE_DOT`                                                                                                                           |
| `EXPO_PUBLIC_` var defined nowhere              | silent   | `void 0`. No build warning or error                                                                                                                 |

At runtime the polyfill is `process.env = process.env || {}; process.env.NODE_ENV = "production"`. So **every non-inlined access is `undefined` on device**.

**Load order** (CLI prints `env: load ...`, export mode = production): `.env.production.local` > `.env.local` > `.env.production` > `.env`. The winning value `order_from_env_production_local` is in the bundle. Note: `.env.local` is loaded in production exports too.

**Plan impact:**

- Bracket access with a string literal is **fine**. Remove it from the error list; flag only non-literal keys.
- Undefined vars become `void 0` silently. This confirms the core bug the tool targets.
- The AST check must run on source, not on the bundle, because of minifier folding.

## Spike 1 — Reading EAS environments ✅ mostly done

- eas-cli 27.2.0 (latest): `env:list` still has **no `--json`**. `env:set` has `--json`, but that's for writes.
- `eas env:pull <env> --non-interactive --path <file>` works with no prompts. Output:
  ```
  # Environment: production

  EXPO_PUBLIC_API_URL=https://prod.example.test
  EXPO_PUBLIC_SENSITIVE=fake_sensitive_value
  # SERVER_SECRET=***** (secret)
  ```
  - Plaintext and sensitive vars are included **with values**.
  - Secret vars are included as a comment: `# NAME=***** (secret)`. The name can be parsed, the value can't. That's enough for "is it defined" checks.
  - Plaintext and sensitive can't be told apart from the pull file. For visibility, parse `env:list <env> --format long` (`Visibility    SENSITIVE`). It's human-oriented output, so fragile. Prefer one `env:list` call per environment for visibility and use pull only if values are needed.
  - Sensitive values land on disk. The tool must use a temp dir and delete the files right away.
- **EAS rejects `EXPO_PUBLIC_` + `secret` server-side** ("Variables prefixed with "EXPO_PUBLIC_" should never be considered as secret"). `sensitive` is allowed and still ships in the bundle. → Drop the `secret` part of that catalogue item; keep `EXPO_PUBLIC_` + `sensitive` as a warning.
- ✅ **CI with only `EXPO_TOKEN` works.** Tested with robot `expo-env-doctor-ci` (role Developer on g99labs), an empty `HOME` (no login session) and `EXPO_TOKEN` set. `whoami`, `env:pull` (all environments) and `env:list --format long` all work. Output is identical to the logged-in run.
- In `env:list --format long`, plaintext vars show as `Visibility    PUBLIC`, not `PLAINTEXT`. The parser must map `PUBLIC | SENSITIVE | SECRET`.
- The Developer role is enough to read sensitive values. Viewer was not tested.

## Spike 3 — What EAS Build uploads ✅ done

Method: `eas build:inspect -p android -s archive -o <dir>` (eas-cli 23.2.0). It builds locally the exact archive EAS uploads, with no cloud build and no credits used. The fixture is inside a git repo whose root is above the app (monorepo-like layout).

| Scenario                           | `.env.local` / `.env.production.local` (gitignored) | `.env`, `.env.production` (committed) | untracked, not ignored         |
| ---------------------------------- | --------------------------------------------------- | ------------------------------------- | ------------------------------ |
| No `.easignore`                    | ❌ not uploaded                                     | ✅                                    | ✅ uploaded (no commit needed) |
| `.easignore` in the **app folder** | ❌ not uploaded (file has **no effect**)            | ✅                                    | ✅                             |
| `.easignore` at the **git root**   | ✅ uploaded                                         | ✅                                    | ✅                             |

- EAS archives from the **git root**, not the app folder. The whole repo is uploaded.
- A `.easignore` at the git root **replaces `.gitignore` completely**: in that run even the gitignored `dist/` got uploaded with all its files.
- Ignored folders appear in the archive as empty directories; their files are not uploaded.
- Not tested: projects outside git (`EAS_NO_VCS=1`). The tool doesn't guess there and treats every file as uploaded.

**Code impact:** `createUploadFilter` originally read `.easignore` from the app folder with a minimal glob, which was wrong for monorepos. It now finds `.easignore` at the git root and lets git evaluate it (`git ls-files --ignored --exclude-from`), with 3 regression tests.

## Fixture state on EAS (for cleanup later)

| Var                     | development | preview | production               | Visibility |
| ----------------------- | ----------- | ------- | ------------------------ | ---------- |
| `EXPO_PUBLIC_DOT`       | ✓           | ✓       | **missing** (deliberate) | plaintext  |
| `EXPO_PUBLIC_API_URL`   | ✓           | ✓       | ✓                        | plaintext  |
| `EXPO_PUBLIC_SENSITIVE` | –           | –       | ✓                        | sensitive  |
| `SERVER_SECRET`         | –           | –       | ✓                        | secret     |

## Demand check ✅ done (weak–moderate)

Date: 2026-10-30. Sources: GitHub issue search (unauthenticated API), Stack Overflow API. Reddit returned 403 to scripts; Discord can't be searched. Not covered.

**Expo's own repos: low.**

- `expo/expo` "EXPO_PUBLIC" + undefined: 5 issues all-time. Biggest: "Expo web not replacing process.env variables" (2023, 46 comments, 41 👍) and "[SDK 53] EXPO_PUBLIC env var not being set" (2025, 14 comments).
- New bug class found: "Android release bundle task reuses stale EXPO_PUBLIC values when environment changes" (expo/expo, 2026-09). It's caused by the Metro cache.
- Stack Overflow: 0 new questions in 12 months (SO is quiet overall). The top all-time question has 5.5k views: "How to read EAS build Secrets and Environment Variables… Getting undefined".

**Across GitHub: real but scattered.** 85 issues in the last 12 months mention `EXPO_PUBLIC_` + undefined. About 27 are actually about env vars. Exact matches for our catalogue:

- "EAS cloud builds have no source for three EXPO_PUBLIC_* variables" (toruiwasa/pulseticker)
- "EAS and CI mobile builds receive no EXPO_PUBLIC_ variables" (utn-integrador-III/2026-bus-traking)
- "@clerk/expo native Google Sign-In fails in production EAS builds when EXPO_PUBLIC_CLE…" (clerk/clerk-docs)
- Secret leaks: "Mobile bundle still inlines the Resend API key" (pollis-app/pollis), "API keys read client-side; move server-side" (thefixer3x/SUB-PRO)
- Teams writing their own checks: "OTA publish guardrails: pk_live preflight, post-publish manifest verification" (Mingla-LLC/mingla-main)
- Stale-cache class again: "Cold Release builds can inline EXPO_PUBLIC values from an earlier bundle via the shared Metro cache" (appandflow/stim, 2 issues)

**Reading:** this is a _silent_ bug. People hit it, fix it locally, and rarely file an issue. Nobody asks for a tool, but at least one team built its own preflight. That's evidence of the pain, not of demand for a package.

**New differentiator idea:** a `--bundle <dist>` audit mode. Grep the exported bundle for the expected value per environment, and for secret-looking values. It catches the stale-Metro-cache class, which source analysis can't see.

## EAS environment for profiles without `environment`

Read from eas-cli 27.2.0 source (`build/build/evaluateConfigWithEnvVarsAsync.js`, `resolveSuggestedEnvironmentForBuildProfileConfiguration`) and `@expo/eas-json` (`distribution` defaults to `store`):

| Profile                                                | EAS environment |
| ------------------------------------------------------ | --------------- |
| `environment` set                                      | that one        |
| `distribution: "store"` (the default)                  | production      |
| `distribution: "internal"` + `developmentClient: true` | development     |
| `distribution: "internal"`, no development client      | preview         |

So a development client profile without `distribution: "internal"` and without `environment` gets production variables.

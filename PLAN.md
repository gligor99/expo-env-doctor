# expo-env-doctor — plan

A CLI that checks whether the environment variables an Expo app uses are actually defined everywhere the app gets built: local `.env*` files, `eas.json` build profiles, and EAS environments (development / preview / production).

The bug it targets: a variable works locally but is `undefined` in an EAS build or an EAS Update. There is no crash at build time; the app breaks at runtime.

> **Status (2026-10-30):** Phase 0 done → Go with a small scope (see `docs/spikes.md`). Spike 3 (gitignored `.env` on EAS Build) was skipped; verify it before release. MVP first pass is implemented in `src/`.
>
> **Not in MVP yet:** `.env.local` committed check, same variable with different values across `.env*` files, EAS Update environment check, `--bundle` audit mode (catches stale Metro cache), config file for ignores, Expo Router `+api` rules beyond skipping.

---

## Phase 0 — Validation (go / no-go)

### Competitors to check
- **Runtime schema validators**: `@t3-oss/env-core`, `envalid`, `zod` env patterns. These validate at app start, on the device, after the build is shipped. They don't know about EAS environments.
- **Generic linters**: `dotenv-linter` (checks `.env` syntax), `knip` (unused deps, not env vars).
- **Expo itself**: `expo-doctor` checks, and EAS CLI warnings (e.g. `EXPO_PUBLIC_` + `secret` visibility).
- Search again: npm (`expo env`, `eas env`, `EXPO_PUBLIC`), GitHub, Expo Discord/forums.

### Feasibility spikes (blocking)
1. **Reading EAS environments without interaction.** On eas-cli 23.2.0, `env:list` has no `--json`. Plan: `eas env:pull <env> --non-interactive --path <tmpfile>` once per environment, then parse it as dotenv. Check:
   - Behaviour on latest eas-cli (26.x). Was `--json` added?
   - What `secret`-visibility vars look like in the pulled file: is the name present without a value, or is the var omitted entirely?
   - Whether it works in CI with only `EXPO_TOKEN`.
   - Fallback if pull is unusable: EAS GraphQL API (undocumented, so fragile).
2. **Inlining rules.** Confirm with a fixture app and `npx expo export` which access patterns babel-preset-expo inlines on the current SDK:
   - `process.env.EXPO_PUBLIC_X` (expected: inlined)
   - `process.env['EXPO_PUBLIC_X']`, `const { EXPO_PUBLIC_X } = process.env`, `process.env[key]` (expected: **not** inlined)
3. **EAS upload rules.** Confirm that a gitignored or `.easignore`d `.env` file is not uploaded to EAS Build, so its vars disappear in the cloud build.

### Demand check
- Search Expo GitHub issues, Discord and Reddit for "EXPO_PUBLIC undefined", "env variable undefined eas build", "eas update env". Count hits from the last 12 months.
- Go if this is a recurring question. Drop if nobody hits it or EAS CLI already warns about it.

---

## Failure catalogue (what the tool must detect)

### Code → definitions
- `EXPO_PUBLIC_*` used in code but not defined in an environment the app is built for (per environment: development / preview / production)
- Defined (in `.env*` or EAS) but never used in code (warning)
- Access pattern that won't be inlined: destructuring, aliasing `process.env`, a non-literal key `process.env[key]`, passing `process.env` whole (error, because it is `undefined` at runtime). Dot, string-literal bracket, `?.` and template access ARE inlined (verified in `docs/spikes.md`)
- Non-`EXPO_PUBLIC_` var read in app code (not in `app.config.*`). It is never inlined into the bundle, so it is always `undefined` on device
- Typo detection: used name close to a defined name (`EXPO_PUBLIC_API_URL` vs `EXPO_PUBLIC_API_URI`)

### Config-time variables
- `app.config.ts/js` reads `process.env.X` that is missing in an environment, so config differs per build (e.g. bundle ID, API keys for plugins)
- `eas.json` build profile with no `environment` field when EAS environments exist (warning: decide which environment it picks up)
- `eas.json` `build.<profile>.env` overriding an EAS environment variable with a different value (info)

### Local files
- `.env` / `.env.local` is gitignored or `.easignore`d, but vars from it are needed in a cloud build (error: not uploaded)
- Same var defined in several `.env*` files with different values; show which file wins per Expo's load order
- `.env.local` committed (warning)

### Security
- `EXPO_PUBLIC_*` whose name or value looks like a secret (`SECRET`, `PRIVATE`, `SERVICE_ROLE`, `sk_live_`, private key header). Everything with `EXPO_PUBLIC_` ships in the bundle
- EAS var with `sensitive` visibility that has the `EXPO_PUBLIC_` prefix (it ends up in the bundle anyway). `secret` + `EXPO_PUBLIC_` is already rejected by EAS server-side, so there's no need to check it
- Values are never printed in output; names only, plus a masked hint like `sk_l…(32)`

### EAS Update
- Var used in code but missing in the environment the update channel uses. Run `eas update --environment X` to check: the update ships a bundle with `undefined`

---

## Possible differentiators (validate in Phase 0)
1. **EAS-aware**: the only tool that compares code against real EAS environments, not just `.env` files.
2. **Static, pre-build**: catches the bug in a PR, not on a user's device.
3. **Expo inlining rules**: knows which access patterns survive the bundler.
4. **Secret leak check** for `EXPO_PUBLIC_`.
5. **CI-ready**: JSON output, exit codes, GitHub Action, works offline (`--offline` skips EAS).

---

## Phase 1 — MVP (only after "go")

**Scope:** code scan + `.env*` files + `eas.json` + EAS environments via `env:pull` + secret check + text/JSON output.

**Tech constraints**
- TypeScript, Node ≥ 20, ESM.
- Code scan via an AST, not regex, so access patterns are classified correctly. Candidate: `oxc-parser` or `@babel/parser`. Decide in Phase 0 based on speed and install size.
- Respect `.gitignore`; skip `node_modules`, `ios/`, `android/`, build output.
- Load `.env*` files with `@expo/env` so the load order matches Expo exactly.
- `app.config.ts` via `npx expo config --json --type public`.
- EAS layer behind an interface (`EnvSource`), so tests use fixtures and never call EAS.
- Never write pulled EAS values to disk outside an OS temp dir; delete right after parsing; never log values.
- Finding shape: `{ id, severity: 'error' | 'warning' | 'info', variable, environment?, file?, line?, message, fix? }`.
- Exit code: `1` on any error, `0` otherwise; `--strict` makes warnings fail too.

**CLI surface (draft)**
```
npx expo-env-doctor [projectDir]
  --environment <name>      limit to one EAS environment (repeatable)
  --offline                 skip EAS, check code vs local files only
  --env-file <path>         treat a file as an environment (e.g. CI secrets dump)
  --json                    machine-readable output
  --strict                  warnings fail the run
  --ignore <VAR>            ignore a variable (repeatable; also via config file)
```

**Testing**
- Vitest unit tests per check, with fixture projects (one per catalogue item).
- Fixture `EnvSource` for EAS; no network in CI.
- One fixture per access pattern, plus a snapshot of what `expo export` actually inlines (from the Phase 0 spike), so tests can break when the Expo SDK changes.

**Definition of done**
- Every catalogue item has a test that fails without the check.
- README: one-command quick start, example output, CI example (with `EXPO_TOKEN`), "why is my var undefined" explainer.
- `npm pack --dry-run` contains only `dist`, README, LICENSE, package.json.
- npm 2FA on; publish via GitHub Actions trusted publishing.

## Phase 2 — later
- GitHub Action wrapper with PR annotations.
- Propose the core checks upstream as `expo-doctor` checks (distribution).
- Generate a typed `env.ts` (with a zod schema) from the vars found.
- Monorepo support (several apps, shared `.env`).

---

## Open questions (for grill-me)
1. Is calling `eas env:pull` acceptable to users? It needs login and writes values to a temp file. Or is `--offline` enough for most of them?
2. How do we map an `eas.json` profile to an environment when the `environment` field is missing? (Default rules need to be confirmed.)
3. Do we scan non-`EXPO_PUBLIC_` vars in server code (Expo Router API routes, `+api.ts`)? They run on the server, so different rules apply.
4. How noisy is "defined but never used"? Vars used only by config plugins or native code would be false positives.
5. Name: `expo-env-doctor` vs `eas-env-check`; check npm availability.

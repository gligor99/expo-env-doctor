import type { EnvAccess, Environment, Finding, ProjectModel, Severity } from './types.js';

const PUBLIC_PREFIX = 'EXPO_PUBLIC_';
/** Inlined by babel-preset-expo or set by Expo itself, so fine to read in app code. */
const EXPO_BUILTINS = /^(?:NODE_ENV|EXPO_OS|EXPO_BASE_URL|EXPO_PROJECT_ROOT|EXPO_ROUTER_[A-Z_]+)$/;
/** Set by EAS or CI at config time, never by the user. */
const CONFIG_BUILTINS = /^(?:NODE_ENV|CI|EAS_BUILD(?:_[A-Z_]+)?|EXPO_[A-Z_]+)$/;
const SECRET_NAME = /SECRET|PRIVATE|PASSWORD|PASSWD|SERVICE_ROLE|ACCESS_KEY|SIGNING/;
const SECRET_VALUES: [RegExp, string][] = [
  [/^sk_(?:live|test)_[A-Za-z0-9]{10,}/, 'a Stripe secret key'],
  [/^rk_(?:live|test)_[A-Za-z0-9]{10,}/, 'a Stripe restricted key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/^AKIA[0-9A-Z]{16}$/, 'an AWS access key ID'],
  [/^(?:ghp|gho|ghs)_[A-Za-z0-9]{36}$|^github_pat_/, 'a GitHub token'],
  [/^xox[abprs]-/, 'a Slack token'],
  [/^sk-ant-/, 'an Anthropic API key'],
  [/^sk-(?:proj-)?[A-Za-z0-9_-]{32,}$/, 'an OpenAI API key'],
];

export function runChecks(model: ProjectModel): Finding[] {
  return [
    ...model.notes,
    ...checkNonInlinedAccess(model),
    ...checkPrivateInApp(model),
    ...checkMissing(model),
    ...checkConfigMissing(model),
    ...checkUnused(model),
    ...checkPublicSecrets(model),
    ...checkEasJsonEnvironment(model),
  ];
}

/** Access patterns babel-preset-expo can't inline: always `undefined` on device. */
export function checkNonInlinedAccess(model: ProjectModel): Finding[] {
  return model.accesses
    .filter((access) => access.fileKind === 'app' && access.kind !== 'inlined')
    .map((access) => {
      const where = { file: access.file, line: access.line, variable: access.name };
      switch (access.kind) {
        case 'destructure':
          return {
            id: 'destructured-env',
            severity: 'error',
            ...where,
            message: `\`${access.name ?? '?'}\` is destructured from process.env. Expo only inlines direct reads, so it is undefined in the app.`,
            fix: `const ${access.name ?? 'NAME'} = process.env.${access.name ?? 'NAME'};`,
          } satisfies Finding;
        case 'dynamic':
          return {
            id: 'dynamic-env-key',
            severity: 'error',
            ...where,
            message: 'process.env is read with a computed key. Expo only inlines static names, so it is undefined in the app.',
            fix: 'Read each variable by name: process.env.EXPO_PUBLIC_X',
          } satisfies Finding;
        case 'alias':
          return {
            id: 'aliased-env',
            severity: 'error',
            ...where,
            message: 'process.env is assigned to a variable. Reads through it are not inlined, so they are undefined in the app.',
            fix: 'Read each variable directly: process.env.EXPO_PUBLIC_X',
          } satisfies Finding;
        default:
          return {
            id: 'whole-env',
            severity: 'error',
            ...where,
            message: 'process.env is used as a whole. In the app it only contains NODE_ENV.',
            fix: 'Read each variable directly: process.env.EXPO_PUBLIC_X',
          } satisfies Finding;
      }
    });
}

/** Variables without the EXPO_PUBLIC_ prefix are never inlined into the app bundle. */
export function checkPrivateInApp(model: ProjectModel): Finding[] {
  return model.accesses
    .filter(
      (access) =>
        access.fileKind === 'app' && access.kind === 'inlined' && access.name && !isPublic(access.name) && !EXPO_BUILTINS.test(access.name),
    )
    .map((access) => ({
      id: 'private-env-in-app',
      severity: 'error',
      variable: access.name,
      file: access.file,
      line: access.line,
      message: `${access.name} has no ${PUBLIC_PREFIX} prefix, so Expo never inlines it. It is undefined in the app.`,
      fix: `Rename it to ${PUBLIC_PREFIX}${access.name} if it is safe to ship to every user, or read it on a server (e.g. an API route).`,
    }));
}

/** Public variables used in app code but not defined in an environment the app is built for. */
export function checkMissing(model: ProjectModel): Finding[] {
  const used = groupByName(
    model.accesses.filter((access) => access.fileKind === 'app' && access.kind === 'inlined' && access.name && isPublic(access.name)),
  );
  const findings: Finding[] = [];
  for (const [name, accesses] of used) {
    const allFallback = accesses.every((access) => access.hasFallback);
    const missing = model.environments.filter((env) => !env.defs.has(name));
    // One finding per severity, so EAS development (a warning) doesn't hide behind production errors.
    for (const [severity, envs] of groupBy(missing, (env) => (allFallback ? soften(env.missingSeverity) : env.missingSeverity))) {
      findings.push({
        id: 'missing-variable',
        severity,
        variable: name,
        environments: envs.map((env) => env.name),
        file: accesses[0]!.file,
        line: accesses[0]!.line,
        message: [
          `${name} is used${accesses.length > 1 ? ` in ${accesses.length} places` : ''} but not defined in ${list(envs)}${allFallback ? ' (every read has a fallback)' : ''}.`,
          ...hints(name, envs),
        ].join(' '),
        fix: fixForEnvironments(envs, name),
      });
    }
  }
  return findings;
}

/** app.config.* reads that differ per environment change the native config of each build. */
export function checkConfigMissing(model: ProjectModel): Finding[] {
  const used = groupByName(
    model.accesses.filter(
      (access) =>
        access.fileKind === 'config' &&
        access.kind === 'inlined' &&
        access.name &&
        !access.hasFallback &&
        !CONFIG_BUILTINS.test(access.name),
    ),
  );
  const findings: Finding[] = [];
  for (const [name, accesses] of used) {
    const missing = model.environments.filter((env) => !env.defs.has(name));
    if (missing.length === 0) continue;
    findings.push({
      id: 'missing-config-variable',
      severity: 'warning',
      variable: name,
      environments: missing.map((env) => env.name),
      file: accesses[0]!.file,
      line: accesses[0]!.line,
      message: [
        `${name} is read in the app config but not defined in ${list(missing)}, and has no fallback.`,
        ...hints(name, missing),
      ].join(' '),
      fix: fixForEnvironments(missing, name),
    });
  }
  return findings;
}

/** Public variables defined somewhere but never read. */
export function checkUnused(model: ProjectModel): Finding[] {
  const usedNames = new Set(model.accesses.flatMap((access) => (access.name ? [access.name] : [])));
  // Computed or whole-object reads could touch any variable.
  const uncertain = model.accesses.some((access) => access.kind === 'dynamic' || access.kind === 'alias' || access.kind === 'whole');
  const sources = new Map<string, Set<string>>();
  for (const env of model.environments) {
    for (const [name, defs] of env.defs) {
      if (!isPublic(name) || usedNames.has(name)) continue;
      const set = sources.get(name) ?? new Set();
      defs.forEach((def) => set.add(def.source));
      sources.set(name, set);
    }
  }
  return [...sources].map(([name, from]) => ({
    id: 'unused-variable',
    severity: uncertain ? 'info' : 'warning',
    variable: name,
    message: `${name} is defined (${[...from].join(', ')}) but never read in the code.`,
    fix: 'Remove it, or ignore it with --ignore if a native module or config plugin reads it.',
  }));
}

/** Everything with the EXPO_PUBLIC_ prefix ships in the app bundle in plain text. */
export function checkPublicSecrets(model: ProjectModel): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const once = (key: string, finding: Finding) => {
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding);
  };
  for (const env of model.environments) {
    for (const [name, defs] of env.defs) {
      if (!isPublic(name)) continue;
      if (SECRET_NAME.test(name.slice(PUBLIC_PREFIX.length))) {
        once(`name:${name}`, {
          id: 'public-secret-name',
          severity: 'error',
          variable: name,
          message: `${name} looks like a secret, but every ${PUBLIC_PREFIX} variable is readable by anyone who downloads the app.`,
          fix: 'Keep the secret on a server (API route, backend) and remove the EXPO_PUBLIC_ prefix.',
        });
      }
      for (const def of defs) {
        const kind = def.value === undefined ? undefined : secretKind(def.value);
        if (kind) {
          once(`value:${name}:${def.source}`, {
            id: 'public-secret-value',
            severity: 'error',
            variable: name,
            message: `${name} in ${def.source} holds what looks like ${kind} (${mask(def.value!)}). It ships in plain text in the app bundle.`,
            fix: 'Rotate the key, move it to a server, and remove the EXPO_PUBLIC_ prefix.',
          });
        }
        if (def.visibility === 'sensitive') {
          once(`sensitive:${name}`, {
            id: 'public-sensitive',
            severity: 'warning',
            variable: name,
            environments: [env.name],
            message: `${name} is marked "sensitive" on EAS, but ${PUBLIC_PREFIX} variables are inlined into the app bundle in plain text anyway.`,
            fix: 'If it is really sensitive, move it to a server. Otherwise set its visibility to plain text.',
          });
        }
      }
    }
  }
  return findings;
}

/** Without `environment`, a build profile doesn't say which EAS variables it gets. */
export function checkEasJsonEnvironment(model: ProjectModel): Finding[] {
  if (model.easEnvironmentsWithVars.length === 0) return [];
  const implicit = model.easProfiles.filter((profile) => profile.implicitEnvironment && !profile.isBase);
  // A development client with the default "store" distribution gets production variables.
  const devClientOnProduction = implicit.filter((profile) => profile.developmentClient && profile.environment === 'production');
  const findings: Finding[] = devClientOnProduction.map((profile) => ({
    id: 'dev-client-production-environment',
    severity: 'warning',
    file: 'eas.json',
    message: `Build profile "${profile.name}" builds a development client but gets the "production" EAS environment, because it has no "environment" and its distribution is "store".`,
    fix: `"${profile.name}": { "environment": "development" }`,
  }));
  const rest = implicit.filter((profile) => !devClientOnProduction.includes(profile));
  if (rest.length > 0) {
    findings.push({
      id: 'eas-profile-without-environment',
      severity: 'info',
      file: 'eas.json',
      environments: unique(rest.map((profile) => profile.environment)),
      message: `Build profiles without "environment" use the one EAS picks: ${rest.map((profile) => `${profile.name} → ${profile.environment}`).join(', ')}.`,
      fix: `Set it explicitly to make it visible, e.g. "${rest[0]!.name}": { "environment": "${rest[0]!.environment}" }`,
    });
  }
  return findings;
}

function hints(name: string, envs: Environment[]): string[] {
  const out: string[] = [];
  const excluded = unique(envs.flatMap((env) => env.excluded.get(name) ?? []).map((def) => def.source));
  if (excluded.length > 0) {
    out.push(`It is defined in ${excluded.join(', ')}, but EAS Build doesn't upload that file (gitignored or in .easignore).`);
  }
  const similar = unique(envs.flatMap((env) => [...env.defs.keys()])).filter((other) => other !== name && distance(other, name) <= 2);
  if (similar.length > 0) out.push(`Did you mean ${similar.join(' or ')}?`);
  return out;
}

function fixForEnvironments(envs: Environment[], name: string): string {
  const eas = envs.filter((env) => env.name.startsWith('eas:')).map((env) => `--environment ${env.name.slice('eas:'.length)}`);
  const fixes: string[] = [];
  if (eas.length > 0) fixes.push(`eas env:set ${eas.join(' ')} --name ${name} --value <value> --visibility plaintext`);
  if (envs.some((env) => !env.name.startsWith('eas:'))) fixes.push(`add ${name}=<value> to .env`);
  return fixes.join(', and ');
}

function list(envs: Environment[]): string {
  return envs.map((env) => env.name).join(', ');
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
  return map;
}

function groupByName(accesses: EnvAccess[]): Map<string, EnvAccess[]> {
  const map = new Map<string, EnvAccess[]>();
  for (const access of accesses) map.set(access.name!, [...(map.get(access.name!) ?? []), access]);
  return map;
}

function isPublic(name: string): boolean {
  return name.startsWith(PUBLIC_PREFIX);
}

function soften(severity: Severity): Severity {
  return severity === 'error' ? 'warning' : 'info';
}

function secretKind(value: string): string | undefined {
  for (const [pattern, kind] of SECRET_VALUES) if (pattern.test(value)) return kind;
  if (jwtRole(value) === 'service_role') return 'a Supabase service_role key';
  return undefined;
}

function jwtRole(value: string): string | undefined {
  const parts = value.split('.');
  if (parts.length !== 3) return undefined;
  try {
    return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'))?.role;
  } catch {
    return undefined;
  }
}

/** Never print a value: first 4 characters and the length are enough to recognise it. */
export function mask(value: string): string {
  return `${value.slice(0, 4)}…(${value.length} chars)`;
}

function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length]!;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

import { describe, expect, it } from 'vitest';
import {
  checkConfigMissing,
  checkEasJsonEnvironment,
  checkMissing,
  checkNonInlinedAccess,
  checkPrivateInApp,
  checkPublicSecrets,
  checkUnused,
  mask,
} from '../src/checks.js';
import type { EnvAccess, Environment, ProjectModel, VarDef } from '../src/types.js';

const access = (name: string | undefined, extra: Partial<EnvAccess> = {}): EnvAccess => ({
  name,
  kind: 'inlined',
  fileKind: 'app',
  file: 'App.tsx',
  line: 1,
  hasFallback: false,
  ...extra,
});

const env = (name: string, defs: VarDef[], extra: Partial<Environment> = {}): Environment => {
  const map = new Map<string, VarDef[]>();
  for (const def of defs) map.set(def.name, [...(map.get(def.name) ?? []), def]);
  return { name, missingSeverity: 'error', defs: map, excluded: new Map(), ...extra };
};

const def = (name: string, value?: string, extra: Partial<VarDef> = {}): VarDef => ({ name, value, source: '.env', ...extra });

const model = (extra: Partial<ProjectModel>): ProjectModel => ({
  root: '/p',
  accesses: [],
  environments: [],
  easProfiles: [],
  easEnvironmentsWithVars: [],
  notes: [],
  ...extra,
});

describe('checkMissing', () => {
  it('flags a variable missing in one environment only', () => {
    const findings = checkMissing(
      model({
        accesses: [access('EXPO_PUBLIC_DOT')],
        environments: [env('eas:preview', [def('EXPO_PUBLIC_DOT', 'a')]), env('eas:production', [])],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: 'missing-variable',
      severity: 'error',
      environments: ['eas:production'],
      variable: 'EXPO_PUBLIC_DOT',
    });
    expect(findings[0]!.fix).toContain('eas env:set --environment production --name EXPO_PUBLIC_DOT');
  });

  it('groups environments per severity into one finding with one fix', () => {
    const findings = checkMissing(
      model({
        accesses: [access('EXPO_PUBLIC_A'), access('EXPO_PUBLIC_A', { line: 9 })],
        environments: [
          env('local', []),
          env('eas:development', [], { missingSeverity: 'warning' }),
          env('eas:preview', []),
          env('eas:production', []),
        ],
      }),
    );
    expect(findings.map((f) => [f.severity, f.environments])).toEqual([
      ['error', ['local', 'eas:preview', 'eas:production']],
      ['warning', ['eas:development']],
    ]);
    expect(findings[0]?.message).toContain('used in 2 places but not defined in local, eas:preview, eas:production.');
    expect(findings[0]?.fix).toBe(
      'eas env:set --environment preview --environment production --name EXPO_PUBLIC_A --value <value> --visibility plaintext, and add EXPO_PUBLIC_A=<value> to .env',
    );
  });

  it('softens severity when every read has a fallback', () => {
    const [finding] = checkMissing(model({ accesses: [access('EXPO_PUBLIC_A', { hasFallback: true })], environments: [env('local', [])] }));
    expect(finding?.severity).toBe('warning');
  });

  it('uses the environment severity (EAS development is a warning)', () => {
    const [finding] = checkMissing(
      model({ accesses: [access('EXPO_PUBLIC_A')], environments: [env('eas:development', [], { missingSeverity: 'warning' })] }),
    );
    expect(finding?.severity).toBe('warning');
  });

  it('suggests a close name', () => {
    const [finding] = checkMissing(
      model({ accesses: [access('EXPO_PUBLIC_API_URL')], environments: [env('local', [def('EXPO_PUBLIC_API_URI', 'x')])] }),
    );
    expect(finding?.message).toContain('Did you mean EXPO_PUBLIC_API_URI?');
  });

  it('explains a gitignored file', () => {
    const excluded = new Map([['EXPO_PUBLIC_A', [def('EXPO_PUBLIC_A', 'x', { source: '.env.local' })]]]);
    const [finding] = checkMissing(model({ accesses: [access('EXPO_PUBLIC_A')], environments: [env('eas:production', [], { excluded })] }));
    expect(finding?.message).toContain(".env.local, but EAS Build doesn't upload that file");
  });

  it('ignores server and config files and non-public names', () => {
    const findings = checkMissing(
      model({
        accesses: [access('EXPO_PUBLIC_A', { fileKind: 'server' }), access('EXPO_PUBLIC_B', { fileKind: 'config' }), access('API_KEY')],
        environments: [env('local', [])],
      }),
    );
    expect(findings).toEqual([]);
  });
});

describe('checkNonInlinedAccess', () => {
  it('flags every non-inlined pattern in app code', () => {
    const findings = checkNonInlinedAccess(
      model({
        accesses: [
          access('EXPO_PUBLIC_A', { kind: 'destructure' }),
          access(undefined, { kind: 'dynamic' }),
          access(undefined, { kind: 'alias' }),
          access(undefined, { kind: 'whole' }),
          access('EXPO_PUBLIC_B'),
          access(undefined, { kind: 'whole', fileKind: 'config' }),
        ],
      }),
    );
    expect(findings.map((f) => f.id)).toEqual(['destructured-env', 'dynamic-env-key', 'aliased-env', 'whole-env']);
    expect(findings[0]?.fix).toBe('const EXPO_PUBLIC_A = process.env.EXPO_PUBLIC_A;');
  });
});

describe('checkPrivateInApp', () => {
  it('flags unprefixed names but not Expo builtins', () => {
    const findings = checkPrivateInApp(
      model({ accesses: [access('API_KEY'), access('NODE_ENV'), access('EXPO_OS'), access('API_KEY', { fileKind: 'server' })] }),
    );
    expect(findings.map((f) => f.variable)).toEqual(['API_KEY']);
  });
});

describe('checkConfigMissing', () => {
  it('flags config reads without fallback, ignores EAS builtins', () => {
    const findings = checkConfigMissing(
      model({
        accesses: [
          access('APP_VARIANT', { fileKind: 'config' }),
          access('BUNDLE_SUFFIX', { fileKind: 'config', hasFallback: true }),
          access('EAS_BUILD_PROFILE', { fileKind: 'config' }),
          access('EXPO_PUBLIC_API_URL', { fileKind: 'config' }),
        ],
        environments: [env('eas:production', [])],
      }),
    );
    expect(findings.map((f) => f.variable)).toEqual(['APP_VARIANT', 'EXPO_PUBLIC_API_URL']);
    expect(findings[0]?.severity).toBe('warning');
  });
});

describe('checkUnused', () => {
  it('flags public variables nobody reads', () => {
    const findings = checkUnused(
      model({
        accesses: [access('EXPO_PUBLIC_A')],
        environments: [env('local', [def('EXPO_PUBLIC_A', '1'), def('EXPO_PUBLIC_OLD', '2'), def('SERVER_ONLY', '3')])],
      }),
    );
    expect(findings).toMatchObject([{ id: 'unused-variable', severity: 'warning', variable: 'EXPO_PUBLIC_OLD' }]);
  });

  it('is only info when a dynamic read could use anything', () => {
    const [finding] = checkUnused(
      model({ accesses: [access(undefined, { kind: 'dynamic' })], environments: [env('local', [def('EXPO_PUBLIC_OLD', '2')])] }),
    );
    expect(finding?.severity).toBe('info');
  });
});

describe('checkPublicSecrets', () => {
  const fakeJwt = (payload: object) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

  it.each([
    ['sk_live_' + 'a'.repeat(24), 'Stripe secret key'],
    ['-----BEGIN PRIVATE KEY-----\nabc', 'private key'],
    ['AKIA' + 'A'.repeat(16), 'AWS access key'],
    [fakeJwt({ role: 'service_role' }), 'service_role'],
  ])('flags secret-looking value %#', (value, kind) => {
    const findings = checkPublicSecrets(model({ environments: [env('local', [def('EXPO_PUBLIC_KEY', value)])] }));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain(kind);
    expect(findings[0]?.message).not.toContain(value);
  });

  it('allows a Supabase anon key', () => {
    expect(
      checkPublicSecrets(model({ environments: [env('local', [def('EXPO_PUBLIC_SUPABASE_ANON_KEY', fakeJwt({ role: 'anon' }))])] })),
    ).toEqual([]);
  });

  it('flags secret-looking names once across environments', () => {
    const findings = checkPublicSecrets(
      model({
        environments: [
          env('local', [def('EXPO_PUBLIC_CLIENT_SECRET', 'x')]),
          env('eas:production', [def('EXPO_PUBLIC_CLIENT_SECRET', 'y')]),
        ],
      }),
    );
    expect(findings.map((f) => f.id)).toEqual(['public-secret-name']);
  });

  it('warns about sensitive visibility', () => {
    const findings = checkPublicSecrets(
      model({ environments: [env('eas:production', [def('EXPO_PUBLIC_TOKEN_URL', 'x', { visibility: 'sensitive' })])] }),
    );
    expect(findings).toMatchObject([{ id: 'public-sensitive', severity: 'warning' }]);
  });

  it('masks values', () => {
    expect(mask('abcdefgh')).toBe('abcd…(8 chars)');
  });
});

describe('checkEasJsonEnvironment', () => {
  it('reports profiles without environment once, as info', () => {
    const profiles = [
      { name: 'preview', environment: 'preview', implicitEnvironment: true, env: {} },
      { name: 'store', environment: 'production', implicitEnvironment: true, env: {} },
      { name: 'production', environment: 'production', env: {} },
      { name: 'base', environment: 'production', implicitEnvironment: true, env: {}, isBase: true },
    ];
    expect(checkEasJsonEnvironment(model({ easProfiles: profiles, easEnvironmentsWithVars: [] }))).toEqual([]);
    const findings = checkEasJsonEnvironment(model({ easProfiles: profiles, easEnvironmentsWithVars: ['preview', 'production'] }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ id: 'eas-profile-without-environment', severity: 'info' });
    expect(findings[0]?.message).toContain('preview → preview, store → production');
  });

  it('warns when a development client gets the production environment', () => {
    const profiles = [{ name: 'development', environment: 'production', implicitEnvironment: true, developmentClient: true, env: {} }];
    const findings = checkEasJsonEnvironment(model({ easProfiles: profiles, easEnvironmentsWithVars: ['production'] }));
    expect(findings).toEqual([expect.objectContaining({ id: 'dev-client-production-environment', severity: 'warning' })]);
  });
});

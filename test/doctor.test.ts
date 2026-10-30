import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runDoctor } from '../src/index.js';
import type { EasSource } from '../src/sources/eas.js';
import type { VarDef } from '../src/types.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>, { git = false } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'eed-test-'));
  dirs.push(root);
  for (const [file, content] of Object.entries({ 'package.json': '{}', ...files })) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  if (git) execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
}

function fakeEas(envs: Record<string, Omit<VarDef, 'source'>[]>): EasSource {
  return {
    read: async (name) => (envs[name] ?? []).map((def) => ({ ...def, source: `eas:${name}` })),
  };
}

const ids = (findings: { id: string; environments?: string[]; variable?: string }[]) =>
  findings.map((f) => [f.id, f.environments?.join(','), f.variable].filter(Boolean).join(' ')).sort();

describe('runDoctor', () => {
  it('reports nothing for a consistent project', async () => {
    const root = project({ 'App.tsx': 'export const a = process.env.EXPO_PUBLIC_A;', '.env': 'EXPO_PUBLIC_A=1' });
    const result = await runDoctor(root, { offline: true });
    expect(result.environments).toEqual(['local', 'production']);
    expect(result.findings).toEqual([]);
  });

  it('checks local development and production files offline', async () => {
    const root = project({
      'App.tsx': 'export const a = process.env.EXPO_PUBLIC_A; export const b = process.env.EXPO_PUBLIC_B;',
      '.env.development': 'EXPO_PUBLIC_A=dev\nEXPO_PUBLIC_B=dev',
      '.env.production': 'EXPO_PUBLIC_A=prod',
    });
    const result = await runDoctor(root, { offline: true });
    expect(ids(result.findings)).toEqual(['missing-variable production EXPO_PUBLIC_B']);
  });

  it('compares code against EAS environments and eas.json', async () => {
    const root = project({
      'App.tsx': 'export const a = process.env.EXPO_PUBLIC_DOT; export const b = process.env.EXPO_PUBLIC_API_URL;',
      'eas.json': JSON.stringify({
        build: {
          base: { env: { EXPO_PUBLIC_API_URL: 'https://from-eas-json.test' } },
          preview: { extends: 'base', environment: 'preview' },
          production: { environment: 'production' },
        },
      }),
    });
    const eas = fakeEas({
      development: [{ name: 'EXPO_PUBLIC_DOT', value: 'd' }],
      preview: [{ name: 'EXPO_PUBLIC_DOT', value: 'p' }],
      production: [{ name: 'EXPO_PUBLIC_API_URL', value: 'https://prod.test' }],
    });
    const result = await runDoctor(root, { eas });
    expect(result.environments).toEqual(['eas:development', 'eas:preview', 'eas:production']);
    expect(ids(result.findings)).toEqual([
      'missing-variable eas:development EXPO_PUBLIC_API_URL',
      'missing-variable eas:production EXPO_PUBLIC_DOT',
    ]);
    expect(result.findings.find((f) => f.environments?.includes('eas:development'))?.severity).toBe('warning');
  });

  it('treats a gitignored .env as not uploaded to EAS Build', async () => {
    const root = project(
      {
        'App.tsx': 'export const a = process.env.EXPO_PUBLIC_A;',
        '.env.local': 'EXPO_PUBLIC_A=1',
        '.gitignore': '.env*.local\n',
        'eas.json': JSON.stringify({ build: { production: { environment: 'production' } } }),
      },
      { git: true },
    );
    const result = await runDoctor(root, { eas: fakeEas({}) });
    const finding = result.findings.find((f) => f.environments?.includes('eas:production'));
    expect(finding?.id).toBe('missing-variable');
    expect(finding?.message).toContain(".env.local, but EAS Build doesn't upload that file");
    // Locally the file is loaded, so `local` is fine.
    expect(result.findings.some((f) => f.environments?.includes('local'))).toBe(false);
  });

  describe('.easignore (rules verified in docs/spikes.md, spike 3)', () => {
    const app = {
      'apps/mobile/App.tsx': 'export const a = process.env.EXPO_PUBLIC_A;',
      'apps/mobile/.env.local': 'EXPO_PUBLIC_A=1',
      'apps/mobile/.gitignore': '.env*.local\n',
      'apps/mobile/eas.json': JSON.stringify({ build: { production: { environment: 'production' } } }),
    };
    const productionMissing = async (root: string) =>
      (await runDoctor(join(root, 'apps/mobile'), { eas: fakeEas({}) })).findings.some((f) => f.environments?.includes('eas:production'));

    it('at the git root replaces .gitignore', async () => {
      const root = project({ ...app, '.easignore': 'node_modules/\n' }, { git: true });
      expect(await productionMissing(root)).toBe(false);
    });

    it('in the app folder is not used when the git root is above it', async () => {
      const root = project({ ...app, 'apps/mobile/.easignore': 'node_modules/\n' }, { git: true });
      expect(await productionMissing(root)).toBe(true);
    });

    it('at the git root can exclude a file .gitignore allows', async () => {
      const root = project(
        {
          'App.tsx': 'export const a = process.env.EXPO_PUBLIC_A;',
          '.env': 'EXPO_PUBLIC_A=1',
          '.easignore': '.env\n',
          'eas.json': JSON.stringify({ build: { production: { environment: 'production' } } }),
        },
        { git: true },
      );
      const finding = (await runDoctor(root, { eas: fakeEas({}) })).findings.find((f) => f.environments?.includes('eas:production'));
      expect(finding?.message).toContain(".env, but EAS Build doesn't upload that file");
    });
  });

  it('skips empty EAS environments that no profile uses', async () => {
    const root = project({ 'App.tsx': 'export const a = process.env.EXPO_PUBLIC_A;' });
    const result = await runDoctor(root, { eas: fakeEas({ production: [{ name: 'EXPO_PUBLIC_A', value: '1' }] }) });
    expect(result.environments).toEqual(['eas:production']);
    expect(result.findings).toEqual([]);
  });

  it('turns an EAS failure into a warning and falls back to local files', async () => {
    const root = project({ 'App.tsx': 'export const a = process.env.EXPO_PUBLIC_A;', '.env': 'EXPO_PUBLIC_A=1' });
    const eas: EasSource = { read: async () => Promise.reject(new Error('Either log in with eas login or set EXPO_TOKEN\nmore')) };
    const result = await runDoctor(root, { eas });
    expect(result.environments).toEqual(['local', 'production']);
    expect(result.findings.filter((f) => f.id === 'eas-unavailable')).toHaveLength(3);
    expect(result.findings.every((f) => f.severity !== 'error')).toBe(true);
  });

  it('honours --ignore', async () => {
    const root = project({ 'App.tsx': 'export const a = process.env.EXPO_PUBLIC_A;', '.env': 'EXPO_PUBLIC_B=1' });
    const result = await runDoctor(root, { offline: true, ignore: ['EXPO_PUBLIC_A', 'EXPO_PUBLIC_B'] });
    expect(result.findings).toEqual([]);
  });

  it('skips node_modules, native folders and tooling configs', async () => {
    const root = project({
      'App.tsx': '',
      'node_modules/lib/index.js': 'process.env.EXPO_PUBLIC_X',
      'android/app/foo.js': 'process.env.EXPO_PUBLIC_X',
      'metro.config.js': 'const { FOO } = process.env;',
    });
    const result = await runDoctor(root, { offline: true });
    expect(result.findings).toEqual([]);
  });
});

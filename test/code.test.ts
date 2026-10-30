import { describe, expect, it } from 'vitest';
import { classifyFile } from '../src/scan/files.js';
import { scanCode } from '../src/scan/code.js';

const scan = (code: string, file = 'App.tsx') =>
  scanCode(code, file, 'app').accesses.map(({ name, kind, hasFallback }) => ({ name, kind, hasFallback }));

// Mirrors the spike in docs/spikes.md (expo export on SDK 58).
describe('scanCode', () => {
  it.each([
    ['process.env.EXPO_PUBLIC_X', 'inlined'],
    ["process.env['EXPO_PUBLIC_X']", 'inlined'],
    ['process.env?.EXPO_PUBLIC_X', 'inlined'],
    ['`${process.env.EXPO_PUBLIC_X}`', 'inlined'],
    ['(process.env as any).EXPO_PUBLIC_X', 'inlined'],
    ['process.env.EXPO_PUBLIC_X!', 'inlined'],
    ["process['env'].EXPO_PUBLIC_X", 'inlined'],
  ])('%s is inlined', (expression, kind) => {
    expect(scan(`export const v = ${expression};`)).toEqual([{ name: 'EXPO_PUBLIC_X', kind, hasFallback: false }]);
  });

  it('flags destructuring with each name', () => {
    expect(scan(`const { EXPO_PUBLIC_A, 'EXPO_PUBLIC_B': b } = process.env;`)).toEqual([
      { name: 'EXPO_PUBLIC_A', kind: 'destructure', hasFallback: false },
      { name: 'EXPO_PUBLIC_B', kind: 'destructure', hasFallback: false },
    ]);
  });

  it('flags a computed key', () => {
    expect(scan(`const key = 'EXPO_PUBLIC_A'; export const v = process.env[key];`)).toEqual([
      { name: undefined, kind: 'dynamic', hasFallback: false },
    ]);
  });

  it('flags an alias', () => {
    expect(scan(`const env = process.env; export const v = env.EXPO_PUBLIC_A;`)).toEqual([
      { name: undefined, kind: 'alias', hasFallback: false },
    ]);
  });

  it('flags process.env used as a whole', () => {
    expect(scan(`console.log(JSON.stringify(process.env));`)).toEqual([{ name: undefined, kind: 'whole', hasFallback: false }]);
  });

  it('detects fallbacks', () => {
    expect(scan(`export const a = process.env.EXPO_PUBLIC_A ?? 'x'; export const b = process.env.EXPO_PUBLIC_B || 'y';`)).toEqual([
      { name: 'EXPO_PUBLIC_A', kind: 'inlined', hasFallback: true },
      { name: 'EXPO_PUBLIC_B', kind: 'inlined', hasFallback: true },
    ]);
  });

  it.each([
    'process.env.EXPO_PUBLIC_A && init(process.env.EXPO_PUBLIC_A)',
    "process.env.EXPO_PUBLIC_A === 'true'",
    'process.env.EXPO_PUBLIC_A ? 1 : 0',
    '!process.env.EXPO_PUBLIC_A',
  ])('treats %s as handling undefined', (expression) => {
    expect(scan(`export const v = ${expression};`)[0]).toEqual({ name: 'EXPO_PUBLIC_A', kind: 'inlined', hasFallback: true });
  });

  it('treats an if test as handling undefined, but not the read inside it', () => {
    expect(scan(`if (process.env.EXPO_PUBLIC_A) init(process.env.EXPO_PUBLIC_A);`).map((a) => a.hasFallback)).toEqual([true, false]);
  });

  it('flags a template literal key, which Expo does not inline', () => {
    expect(scan('export const v = process.env[`EXPO_PUBLIC_A`];')).toEqual([{ name: undefined, kind: 'dynamic', hasFallback: false }]);
  });

  it('ignores writes', () => {
    expect(scan(`process.env.EXPO_PUBLIC_A = '1';`)).toEqual([]);
  });

  it('reports line numbers', () => {
    expect(scanCode(`\n\nconst v = process.env.EXPO_PUBLIC_A;`, 'a.ts', 'app').accesses[0]?.line).toBe(3);
  });

  it('parses JSX', () => {
    expect(scan(`export default () => <Text>{process.env.EXPO_PUBLIC_A}</Text>;`)).toHaveLength(1);
  });
});

describe('classifyFile', () => {
  it.each([
    ['App.tsx', 'app'],
    ['app/(tabs)/index.tsx', 'app'],
    ['app.config.ts', 'config'],
    ['app/api/user+api.ts', 'server'],
    ['metro.config.js', 'tooling'],
    ['src/foo.test.ts', undefined],
    ['src/__tests__/foo.ts', undefined],
    ['scripts/seed.ts', 'tooling'],
    ['plugins/withSentry.js', 'tooling'],
    ['e2e/login.test.ts', undefined],
    ['e2e/helpers.ts', 'tooling'],
    ['__mocks__/expo-constants.ts', 'tooling'],
    ['jest.setup.ts', 'tooling'],
    ['jest-setup.js', 'tooling'],
    ['src/setupTests.ts', 'tooling'],
    ['src/plugins/analytics.ts', 'app'],
    ['types/env.d.ts', undefined],
  ])('%s → %s', (file, kind) => {
    expect(classifyFile(file)).toBe(kind);
  });
});

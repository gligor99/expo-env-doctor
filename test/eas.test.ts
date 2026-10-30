import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EasCliSource, parseEnvListLong, parsePulledEnv } from '../src/sources/eas.js';

describe('EasCliSource', () => {
  it('runs eas-cli once before reading environments in parallel', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eed-fake-eas-'));
    try {
      const log = join(dir, 'calls.log');
      const fake = join(dir, 'eas.mjs');
      writeFileSync(
        fake,
        [
          "import { appendFileSync, writeFileSync } from 'node:fs';",
          'const args = process.argv.slice(2);',
          `appendFileSync(${JSON.stringify(log)}, args.slice(0, 2).join(' ') + '\\n');`,
          "if (args[0] === 'env:pull') writeFileSync(args[args.indexOf('--path') + 1], 'EXPO_PUBLIC_A=' + args[1]);",
          "if (args[0] === 'env:list') console.log('Name EXPO_PUBLIC_A\\nVisibility PUBLIC');",
        ].join('\n'),
      );
      const source = new EasCliSource(dir, [process.execPath, fake]);
      const [preview, production] = await Promise.all([source.read('preview'), source.read('production')]);
      expect(preview).toEqual([{ name: 'EXPO_PUBLIC_A', value: 'preview', source: 'eas:preview', visibility: 'plaintext' }]);
      expect(production[0]?.value).toBe('production');
      const calls = readFileSync(log, 'utf8').trim().split('\n');
      expect(calls[0]).toBe('--version');
      expect(calls.filter((call) => call === '--version')).toHaveLength(1);
      expect(calls).toHaveLength(5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Real output shapes from eas-cli 27.2.0 (see docs/spikes.md), with fake values.
describe('parsePulledEnv', () => {
  it('reads values and secret names', () => {
    const text =
      '# Environment: production\n\nEXPO_PUBLIC_API_URL=https://prod.example.test\nEXPO_PUBLIC_SENSITIVE=fake_sensitive_value\n# SERVER_SECRET=***** (secret)';
    expect(parsePulledEnv(text, 'eas:production')).toEqual([
      { name: 'EXPO_PUBLIC_API_URL', value: 'https://prod.example.test', source: 'eas:production' },
      { name: 'EXPO_PUBLIC_SENSITIVE', value: 'fake_sensitive_value', source: 'eas:production' },
      { name: 'SERVER_SECRET', source: 'eas:production', visibility: 'secret' },
    ]);
  });

  it('unquotes values', () => {
    expect(parsePulledEnv('A="x y"\nB=\'z\'', 's').map((d) => d.value)).toEqual(['x y', 'z']);
  });
});

describe('parseEnvListLong', () => {
  it('maps PUBLIC to plaintext', () => {
    const text = [
      'ID            1',
      'Name          EXPO_PUBLIC_API_URL',
      'Value         https://prod.example.test',
      'Visibility    PUBLIC',
      '',
      '———',
      '',
      'Name          EXPO_PUBLIC_SENSITIVE',
      'Value         ***** (This is a sensitive env variable.)',
      'Visibility    SENSITIVE',
      'Name          SERVER_SECRET',
      'Visibility    SECRET',
    ].join('\n');
    expect(Object.fromEntries(parseEnvListLong(text))).toEqual({
      EXPO_PUBLIC_API_URL: 'plaintext',
      EXPO_PUBLIC_SENSITIVE: 'sensitive',
      SERVER_SECRET: 'secret',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { parseEnvListLong, parsePulledEnv } from '../src/sources/eas.js';

// Real output shapes from eas-cli 27.2.0 (see docs/spikes.md), with fake values.
describe('parsePulledEnv', () => {
  it('reads values and secret names', () => {
    const text = '# Environment: production\n\nEXPO_PUBLIC_API_URL=https://prod.example.test\nEXPO_PUBLIC_SENSITIVE=fake_sensitive_value\n# SERVER_SECRET=***** (secret)';
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

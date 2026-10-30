import { getEnvFiles, parseEnvFiles } from '@expo/env';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { VarDef } from '../types.js';

export type EnvMode = 'development' | 'production';

export interface EnvFile {
  /** Path relative to the project root, e.g. `.env.local`. */
  file: string;
  defs: VarDef[];
}

/**
 * Reads the `.env*` files Expo loads for `mode`, highest priority first,
 * using Expo's own file order and parser.
 */
export function readEnvFiles(root: string, mode: EnvMode): EnvFile[] {
  const out: EnvFile[] = [];
  for (const file of getEnvFiles({ mode, silent: true })) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    // An empty systemEnv keeps `${VAR}` expansion from leaking in values from this shell.
    const { env } = parseEnvFiles([path], { systemEnv: {} });
    out.push({ file, defs: Object.entries(env).map(([name, value]) => ({ name, value, source: file })) });
  }
  return out;
}

/** True when any `.env*` file that Expo could load exists. */
export function hasAnyEnvFile(root: string): boolean {
  const names = new Set([...getEnvFiles({ mode: 'development', silent: true }), ...getEnvFiles({ mode: 'production', silent: true })]);
  return [...names].some((file) => existsSync(join(root, file)));
}

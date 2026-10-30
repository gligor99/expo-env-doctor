import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EasProfile } from '../types.js';

export interface EasJson {
  profiles: EasProfile[];
  error?: string;
}

/** Build profiles from eas.json, with `extends` resolved for `environment` and `env`. */
export function readEasJson(root: string): EasJson {
  const path = join(root, 'eas.json');
  if (!existsSync(path)) return { profiles: [] };
  let json: { build?: Record<string, RawProfile> };
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return { profiles: [], error: (error as Error).message };
  }
  const raw = json.build ?? {};
  const resolve = (name: string, seen: Set<string>): Omit<EasProfile, 'name'> => {
    const profile = raw[name];
    if (!profile || seen.has(name)) return { env: {} };
    seen.add(name);
    const base = profile.extends ? resolve(profile.extends, seen) : { env: {} };
    return {
      environment: profile.environment ?? base.environment,
      env: { ...base.env, ...(profile.env ?? {}) },
    };
  };
  const bases = new Set(Object.values(raw).flatMap((profile) => (profile.extends ? [profile.extends] : [])));
  return { profiles: Object.keys(raw).map((name) => ({ name, ...resolve(name, new Set()), ...(bases.has(name) ? { isBase: true } : {}) })) };
}

interface RawProfile {
  extends?: string;
  environment?: string;
  env?: Record<string, string>;
}

/**
 * EAS project ID from the app config. Static `app.json` is read directly;
 * a dynamic `app.config.*` is evaluated with the project's own `expo config`.
 */
export function readEasProjectId(root: string): string | undefined {
  const dynamic = ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs'].some((file) => existsSync(join(root, file)));
  if (dynamic) {
    try {
      const out = execFileSync('npx', ['--no-install', 'expo', 'config', '--json', '--type', 'public'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 60_000,
      });
      return JSON.parse(out)?.extra?.eas?.projectId;
    } catch {
      return undefined;
    }
  }
  const appJson = join(root, 'app.json');
  if (!existsSync(appJson)) return undefined;
  try {
    const json = JSON.parse(readFileSync(appJson, 'utf8'));
    return (json.expo ?? json)?.extra?.eas?.projectId;
  } catch {
    return undefined;
  }
}

/**
 * Files EAS Build won't upload. EAS uses `.easignore` instead of `.gitignore` when it exists.
 * Returns undefined when it can't be decided (no git repo and no .easignore).
 */
export function createUploadFilter(root: string): ((file: string) => boolean) | undefined {
  const easignore = join(root, '.easignore');
  if (existsSync(easignore)) {
    const patterns = readFileSync(easignore, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    return (file) => !patterns.some((pattern) => globToRegExp(pattern).test(file));
  }
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, stdio: 'ignore' });
  } catch {
    return undefined;
  }
  return (file) => {
    try {
      execFileSync('git', ['check-ignore', '-q', '--', file], { cwd: root, stdio: 'ignore' });
      return false;
    } catch {
      return true;
    }
  };
}

/** Minimal gitignore-style glob for root-level files: `*`, `?`, optional leading `/`. */
function globToRegExp(pattern: string): RegExp {
  const body = pattern
    .replace(/^\//, '')
    .replace(/\/$/, '')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${body}$`);
}

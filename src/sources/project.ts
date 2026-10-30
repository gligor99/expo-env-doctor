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
  const resolve = (name: string, seen: Set<string>): RawProfile => {
    const profile = raw[name];
    if (!profile || seen.has(name)) return {};
    seen.add(name);
    const base = profile.extends ? resolve(profile.extends, seen) : {};
    return { ...base, ...profile, env: { ...base.env, ...profile.env } };
  };
  // A profile that sets its own `environment` is built for it even when others extend it (`preview` extends `production`).
  const bases = new Set(
    Object.values(raw).flatMap((profile) => (profile.extends && !raw[profile.extends]?.environment ? [profile.extends] : [])),
  );
  return {
    profiles: Object.keys(raw).map((name) => {
      const profile = resolve(name, new Set());
      return {
        name,
        environment: profile.environment ?? defaultEnvironment(profile),
        ...(profile.environment ? {} : { implicitEnvironment: true }),
        ...(profile.developmentClient ? { developmentClient: true } : {}),
        env: profile.env ?? {},
        ...(bases.has(name) ? { isBase: true } : {}),
      };
    }),
  };
}

/** What EAS Build uses when a profile has no `environment` (eas-cli 27, resolveSuggestedEnvironmentForBuildProfileConfiguration). */
function defaultEnvironment(profile: RawProfile): string {
  // `distribution` defaults to "store".
  if ((profile.distribution ?? 'store') === 'store') return 'production';
  return profile.developmentClient ? 'development' : 'preview';
}

interface RawProfile {
  extends?: string;
  environment?: string;
  distribution?: string;
  developmentClient?: boolean;
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
 * Files EAS Build won't upload, decided by git the same way EAS does.
 * EAS archives from the git root; a `.easignore` there replaces `.gitignore` completely,
 * and a `.easignore` in a subfolder is not used (verified in docs/spikes.md, spike 3).
 * Returns undefined outside a git repo, where the rules haven't been verified.
 */
export function createUploadFilter(root: string): ((file: string) => boolean) | undefined {
  let top: string;
  try {
    top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
  const easignore = join(top, '.easignore');
  if (existsSync(easignore)) {
    return (file) => {
      try {
        const out = execFileSync('git', ['ls-files', '--cached', '--others', '--ignored', `--exclude-from=${easignore}`, '--', file], {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        return out.trim() === '';
      } catch {
        // Same as outside git: assume it is uploaded.
        return true;
      }
    };
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

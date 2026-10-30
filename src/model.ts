import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanCode } from './scan/code.js';
import { classifyFile, listSourceFiles } from './scan/files.js';
import { hasAnyEnvFile, readEnvFiles } from './sources/dotenv.js';
import type { EasSource } from './sources/eas.js';
import { createUploadFilter, readEasJson } from './sources/project.js';
import type { EasProfile, Environment, Finding, ProjectModel, VarDef } from './types.js';

export const DEFAULT_EAS_ENVIRONMENTS = ['development', 'preview', 'production'];

export interface BuildOptions {
  /** Undefined skips EAS entirely (`--offline`, or the project isn't linked to EAS). */
  eas?: EasSource;
  /** Limit EAS environments to these names. */
  environments?: string[];
}

export async function buildModel(root: string, options: BuildOptions = {}): Promise<ProjectModel> {
  const notes: Finding[] = [];

  const accesses = [];
  for (const file of listSourceFiles(root)) {
    const fileKind = classifyFile(file);
    if (!fileKind) continue;
    const result = scanCode(readFileSync(join(root, file), 'utf8'), file, fileKind);
    if (result.parseError) {
      notes.push({ id: 'parse-error', severity: 'info', file, message: `Could not parse file, skipped: ${result.parseError}` });
    }
    accesses.push(...result.accesses);
  }

  const easJson = readEasJson(root);
  if (easJson.error)
    notes.push({ id: 'eas-json-invalid', severity: 'error', file: 'eas.json', message: `eas.json is not valid JSON: ${easJson.error}` });

  const environments: Environment[] = [];
  const hasEnvFiles = hasAnyEnvFile(root);
  if (hasEnvFiles) {
    // `expo start` loads development-mode files, including gitignored ones.
    environments.push(
      localEnvironment(
        'local',
        readEnvFiles(root, 'development').flatMap((file) => file.defs),
      ),
    );
  }

  const easEnvironmentsWithVars: string[] = [];
  const builtProfiles = easJson.profiles.filter((profile) => !profile.isBase);
  if (options.eas) {
    const wanted = options.environments ?? unique([...DEFAULT_EAS_ENVIRONMENTS, ...builtProfiles.map((profile) => profile.environment)]);
    const isUploaded = createUploadFilter(root);
    // EAS Build bundles JS in production mode, from the files it uploaded.
    const productionFiles = readEnvFiles(root, 'production');
    const results = await Promise.allSettled(wanted.map((name) => options.eas!.read(name)));
    results.forEach((result, i) => {
      const name = wanted[i]!;
      if (result.status === 'rejected') {
        notes.push({
          id: 'eas-unavailable',
          severity: 'warning',
          environments: [name],
          message: `Could not read EAS environment "${name}": ${firstLine(result.reason)}`,
          fix: 'Run `eas login` (or set EXPO_TOKEN in CI), or pass --offline to check local files only.',
        });
        return;
      }
      const usedByProfile = builtProfiles.some((profile) => profile.environment === name);
      if (result.value.length > 0) easEnvironmentsWithVars.push(name);
      // An empty environment nobody builds with would flag every variable as missing.
      if (result.value.length === 0 && !usedByProfile && !options.environments) return;
      environments.push(easEnvironment(name, result.value, builtProfiles, productionFiles, isUploaded));
    });
  }
  if (!environments.some((env) => env.name.startsWith('eas:')) && hasEnvFiles) {
    environments.push(
      localEnvironment(
        'production',
        readEnvFiles(root, 'production').flatMap((file) => file.defs),
      ),
    );
  }

  return { root, accesses, environments, easProfiles: easJson.profiles, easEnvironmentsWithVars, notes };
}

function localEnvironment(name: string, defs: VarDef[]): Environment {
  return { name, missingSeverity: 'error', defs: group(defs), excluded: new Map() };
}

function easEnvironment(
  name: string,
  easDefs: VarDef[],
  profiles: EasProfile[],
  productionFiles: ReturnType<typeof readEnvFiles>,
  isUploaded: ((file: string) => boolean) | undefined,
): Environment {
  const profileDefs = profiles
    .filter((profile) => profile.environment === name)
    .flatMap((profile) => Object.entries(profile.env).map(([key, value]) => ({ name: key, value, source: `eas.json:${profile.name}` })));
  const uploaded: VarDef[] = [];
  const excluded: VarDef[] = [];
  for (const file of productionFiles) (isUploaded && !isUploaded(file.file) ? excluded : uploaded).push(...file.defs);
  const builtWith = profiles.filter((profile) => profile.environment === name);
  return {
    name: `eas:${name}`,
    // Development clients load JS from the local dev server, so app code never sees these EAS values.
    // Without profile info, `development` is assumed to be mostly development builds.
    missingSeverity:
      builtWith.length > 0 && builtWith.every((profile) => profile.developmentClient)
        ? 'info'
        : name === 'development'
          ? 'warning'
          : 'error',
    defs: group([...easDefs, ...profileDefs, ...uploaded]),
    excluded: group(excluded),
  };
}

function group(defs: VarDef[]): Map<string, VarDef[]> {
  const map = new Map<string, VarDef[]>();
  for (const def of defs) map.set(def.name, [...(map.get(def.name) ?? []), def]);
  return map;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function firstLine(reason: unknown): string {
  const text = reason instanceof Error ? reason.message : String(reason);
  return (
    text
      .split('\n')
      .find((line) => line.trim())
      ?.trim() ?? 'unknown error'
  );
}

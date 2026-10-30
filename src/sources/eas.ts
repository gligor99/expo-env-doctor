import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { VarDef, Visibility } from '../types.js';

const run = promisify(execFile);

/** Reads EAS environment variables. An interface so tests never call EAS. */
export interface EasSource {
  read(environment: string): Promise<VarDef[]>;
}

/**
 * Uses EAS CLI, which has no JSON output for `env:list`:
 * `env:pull` gives names and values (secrets as `# NAME=***** (secret)`),
 * `env:list --format long` gives visibility.
 */
export class EasCliSource implements EasSource {
  constructor(
    private readonly root: string,
    private readonly command: string[] = defaultCommand(),
  ) {}

  async read(environment: string): Promise<VarDef[]> {
    const [values, visibility] = await Promise.all([this.pull(environment), this.list(environment)]);
    return values.map((def) => ({ ...def, visibility: visibility.get(def.name) ?? def.visibility }));
  }

  private async pull(environment: string): Promise<VarDef[]> {
    // Pulled files hold sensitive values: keep them in a private temp dir and delete right away.
    const dir = await mkdtemp(join(tmpdir(), 'expo-env-doctor-'));
    try {
      const path = join(dir, 'pulled.env');
      await this.exec(['env:pull', environment, '--non-interactive', '--path', path]);
      return parsePulledEnv(await readFile(path, 'utf8'), `eas:${environment}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async list(environment: string): Promise<Map<string, Visibility>> {
    return parseEnvListLong(await this.exec(['env:list', environment, '--format', 'long']));
  }

  private async exec(args: string[]): Promise<string> {
    const [bin, ...prefix] = this.command;
    const { stdout } = await run(bin!, [...prefix, ...args], {
      cwd: this.root,
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  }
}

function defaultCommand(): string[] {
  return process.env.EXPO_ENV_DOCTOR_EAS ? process.env.EXPO_ENV_DOCTOR_EAS.split(' ') : ['npx', '--yes', 'eas-cli'];
}

/** Parses the file written by `eas env:pull`. Secret variables appear as `# NAME=***** (secret)`. */
export function parsePulledEnv(text: string, source: string): VarDef[] {
  const defs: VarDef[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const secret = /^#\s*([A-Za-z_][A-Za-z0-9_]*)=\*+\s*\(secret\)\s*$/.exec(line);
    if (secret) {
      defs.push({ name: secret[1]!, source, visibility: 'secret' });
      continue;
    }
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    defs.push({ name: match[1]!, value: unquote(match[2]!), source });
  }
  return defs;
}

/** Parses `eas env:list --format long`, which prints `Name ...` and `Visibility ...` lines per variable. */
export function parseEnvListLong(text: string): Map<string, Visibility> {
  const out = new Map<string, Visibility>();
  let name: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const nameMatch = /^Name\s+(\S+)/.exec(line);
    if (nameMatch) {
      name = nameMatch[1];
      continue;
    }
    const visibilityMatch = /^Visibility\s+(\S+)/.exec(line);
    if (visibilityMatch && name) {
      // EAS prints plaintext variables as PUBLIC.
      const value = visibilityMatch[1]!.toUpperCase();
      out.set(name, value === 'SECRET' ? 'secret' : value === 'SENSITIVE' ? 'sensitive' : 'plaintext');
      name = undefined;
    }
  }
  return out;
}

function unquote(value: string): string {
  const quoted = /^(['"])(.*)\1$/.exec(value);
  return quoted ? quoted[2]! : value;
}

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import type { FileKind } from '../types.js';

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIRS = new Set(['node_modules', 'ios', 'android', 'dist', 'build', 'web-build', 'coverage', 'spikes']);
const TEST_FILE = /(?:\.(?:test|spec)\.[cm]?[jt]sx?$)|(?:(?:^|\/)__tests__\/)/;
const TOOLING_CONFIG = /(?:^|\/)[^/]+\.config\.[cm]?[jt]s$/;
const APP_CONFIG = /^app\.config\.[cm]?[jt]s$/;
const API_ROUTE = /\+(?:api|middleware)\.[cm]?[jt]sx?$/;

/**
 * Source files to scan, relative to `root`, with `/` separators.
 * Uses git to respect .gitignore when the project is a git repo, otherwise walks the tree.
 */
export function listSourceFiles(root: string): string[] {
  const files = gitFiles(root) ?? walk(root, root);
  return files.filter((file) => SOURCE_EXT.test(file) && !isSkipped(file)).sort();
}

/** Decides which rules apply to a file, or `undefined` for files that should not be scanned. */
export function classifyFile(file: string): FileKind | undefined {
  if (file.endsWith('.d.ts') || TEST_FILE.test(file)) return undefined;
  if (APP_CONFIG.test(file)) return 'config';
  // metro.config.js, babel.config.js, scripts/ etc. run in Node and read env legitimately.
  if (TOOLING_CONFIG.test(file) || file.startsWith('scripts/')) return 'tooling';
  if (API_ROUTE.test(file)) return 'server';
  return 'app';
}

function isSkipped(file: string): boolean {
  return file.split('/').some((part) => SKIP_DIRS.has(part) || (part.startsWith('.') && part !== '.'));
}

function gitFiles(root: string): string[] | undefined {
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
    return out.split('\0').filter(Boolean);
  } catch {
    return undefined;
  }
}

function walk(root: string, dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      out.push(...walk(root, join(dir, entry.name)));
    } else if (entry.isFile() && SOURCE_EXT.test(basename(entry.name))) {
      out.push(relative(root, join(dir, entry.name)).split(sep).join('/'));
    }
  }
  return out;
}

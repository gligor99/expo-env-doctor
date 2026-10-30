#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { runDoctor } from './index.js';
import { formatJson, formatText } from './report.js';

const HELP = `Usage: expo-env-doctor [projectDir] [options]

Checks that every environment variable your Expo app reads is defined
in .env files, eas.json and EAS environments, and that it is read in a way Expo inlines.

Options:
  --environment <name>   Only check this EAS environment (repeatable)
  --offline              Skip EAS; check code against local .env files only
  --ignore <VAR>         Ignore findings for a variable (repeatable)
  --json                 Machine-readable output
  --strict               Exit with 1 on warnings too
  -h, --help             Show this help

Exit codes: 0 no errors, 1 errors found, 2 usage or runtime error.`;

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        environment: { type: 'string', multiple: true },
        offline: { type: 'boolean', default: false },
        ignore: { type: 'string', multiple: true },
        json: { type: 'boolean', default: false },
        strict: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${HELP}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const root = resolve(positionals[0] ?? '.');
  if (!existsSync(resolve(root, 'package.json'))) {
    console.error(`No package.json in ${root}. Run this in an Expo project or pass its path.`);
    return 2;
  }

  if (!values.json && !values.offline) console.error('Reading EAS environments… (use --offline to skip)');
  const result = await runDoctor(root, { offline: values.offline, environments: values.environment, ignore: values.ignore });
  console.log(values.json ? formatJson(result.findings, result.environments) : formatText(result.findings, result.environments, process.stdout.isTTY === true));

  const failing = result.findings.some((f) => f.severity === 'error' || (values.strict && f.severity === 'warning'));
  return failing ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 2;
  },
);

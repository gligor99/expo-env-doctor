import { runChecks } from './checks.js';
import { buildModel } from './model.js';
import { EasCliSource, type EasSource } from './sources/eas.js';
import { readEasProjectId } from './sources/project.js';
import type { Finding } from './types.js';

export interface DoctorOptions {
  offline?: boolean;
  environments?: string[];
  ignore?: string[];
  /** Override the EAS source (tests). */
  eas?: EasSource;
}

export interface DoctorResult {
  environments: string[];
  findings: Finding[];
}

export async function runDoctor(root: string, options: DoctorOptions = {}): Promise<DoctorResult> {
  const notes: Finding[] = [];
  let eas = options.eas;
  if (!eas && !options.offline) {
    if (readEasProjectId(root)) {
      eas = new EasCliSource(root);
    } else {
      notes.push({
        id: 'eas-not-linked',
        severity: 'info',
        message: 'No EAS project ID in the app config, so EAS environments were not checked.',
      });
    }
  }
  const model = await buildModel(root, { eas, environments: options.environments });
  const ignored = new Set(options.ignore ?? []);
  const findings = [...notes, ...runChecks(model)].filter((finding) => !finding.variable || !ignored.has(finding.variable));
  return { environments: model.environments.map((env) => env.name), findings };
}

export type { Finding, Severity } from './types.js';

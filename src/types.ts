export type Severity = 'error' | 'warning' | 'info';

export interface Finding {
  id: string;
  severity: Severity;
  message: string;
  variable?: string;
  environments?: string[];
  file?: string;
  line?: number;
  fix?: string;
}

/** Where a file's code runs, which decides the rules that apply to it. */
/** `tooling`: Node-side files (metro.config.js, scripts/) that only count as reads for the unused check. */
export type FileKind = 'app' | 'config' | 'server' | 'tooling';

export type AccessKind =
  /** `process.env.X`, `process.env['X']`, `process.env?.X`: inlined by babel-preset-expo. */
  | 'inlined'
  /** `const { X } = process.env`: never inlined. */
  | 'destructure'
  /** `process?.env.X`, `process?.env?.X`: babel-preset-expo only matches a plain `process.env`, so never inlined. */
  | 'optional-process'
  /** `process.env[key]` with a non-literal key: never inlined. */
  | 'dynamic'
  /** `const env = process.env`: never inlined. */
  | 'alias'
  /** `process.env` passed or spread as a whole: never inlined. */
  | 'whole';

export interface EnvAccess {
  /** Variable name, when it can be known statically. */
  name?: string;
  kind: AccessKind;
  fileKind: FileKind;
  file: string;
  line: number;
  /** Read as `process.env.X ?? fallback` or `|| fallback`. */
  hasFallback: boolean;
}

export type Visibility = 'plaintext' | 'sensitive' | 'secret';

export interface VarDef {
  name: string;
  /** Undefined for EAS secrets, which can't be read outside EAS servers. */
  value?: string;
  /** File path relative to the project, `eas:<environment>` or `eas.json:<profile>`. */
  source: string;
  visibility?: Visibility;
}

export interface Environment {
  name: string;
  /** Severity for a variable that is used in app code but missing here. */
  missingSeverity: Severity;
  defs: Map<string, VarDef[]>;
  /** Variables defined in local files that are excluded from this environment (e.g. gitignored for EAS Build). */
  excluded: Map<string, VarDef[]>;
}

export interface EasProfile {
  name: string;
  /** The EAS environment its builds use: set in eas.json, or the one EAS picks when it isn't. */
  environment: string;
  /** eas.json doesn't set `environment`, so EAS picked it. */
  implicitEnvironment?: boolean;
  developmentClient?: boolean;
  env: Record<string, string>;
  /** Other profiles extend this one, so it is likely a shared base, not built directly. */
  isBase?: boolean;
}

export interface ProjectModel {
  root: string;
  accesses: EnvAccess[];
  environments: Environment[];
  easProfiles: EasProfile[];
  /** Names of EAS environments that have at least one variable. */
  easEnvironmentsWithVars: string[];
  /** Notes about sources that could not be read (EAS offline, parse errors). */
  notes: Finding[];
}

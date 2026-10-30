import type { Finding, Severity } from './types.js';

const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      ORDER[a.severity] - ORDER[b.severity] ||
      (a.file ?? '').localeCompare(b.file ?? '') ||
      (a.line ?? 0) - (b.line ?? 0) ||
      (a.variable ?? '').localeCompare(b.variable ?? ''),
  );
}

export function summarize(findings: Finding[]) {
  return {
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warning').length,
    infos: findings.filter((f) => f.severity === 'info').length,
  };
}

export function formatJson(findings: Finding[], environments: string[]): string {
  return JSON.stringify({ version: 1, environments, summary: summarize(findings), findings: sortFindings(findings) }, null, 2);
}

export function formatText(findings: Finding[], environments: string[], color: boolean): string {
  const paint = (code: number, text: string) => (color ? `\u001b[${code}m${text}\u001b[0m` : text);
  const label: Record<Severity, string> = {
    error: paint(31, 'ERROR'),
    warning: paint(33, 'WARN '),
    info: paint(36, 'INFO '),
  };
  const lines = [paint(2, `Checked: ${environments.length > 0 ? environments.join(', ') : 'code only (no .env files or EAS environments found)'}`), ''];
  for (const finding of sortFindings(findings)) {
    const location = finding.file ? paint(2, `${finding.file}${finding.line ? `:${finding.line}` : ''}`) : '';
    lines.push(`${label[finding.severity]}  ${finding.message}`);
    if (location) lines.push(`       ${location}`);
    if (finding.fix) lines.push(`       ${paint(32, 'fix:')} ${finding.fix}`);
    lines.push('');
  }
  const { errors, warnings, infos } = summarize(findings);
  lines.push(findings.length === 0 ? paint(32, 'No problems found.') : `${errors} error(s), ${warnings} warning(s), ${infos} info`);
  return lines.join('\n');
}

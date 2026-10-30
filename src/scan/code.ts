import { parse } from '@babel/parser';
import type { Node } from '@babel/types';
import type { AccessKind, EnvAccess, FileKind } from '../types.js';

/** Wrappers that don't change which value is read: `(process.env as any)`, `process.env!`, parentheses. */
const TRANSPARENT = new Set([
  'TSAsExpression',
  'TSNonNullExpression',
  'TSSatisfiesExpression',
  'TSTypeAssertion',
  'ParenthesizedExpression',
]);

export interface ScanResult {
  accesses: EnvAccess[];
  parseError?: string;
}

/** Finds every read of `process.env` in one source file and classifies whether Expo inlines it. */
export function scanCode(code: string, file: string, fileKind: FileKind): ScanResult {
  let ast;
  try {
    ast = parse(code, {
      sourceType: 'unambiguous',
      plugins: file.endsWith('.ts') || file.endsWith('.mts') || file.endsWith('.cts') ? ['typescript'] : ['typescript', 'jsx'],
      errorRecovery: true,
    });
  } catch (error) {
    return { accesses: [], parseError: (error as Error).message };
  }

  const accesses: EnvAccess[] = [];
  const add = (kind: AccessKind, node: Node, name?: string, hasFallback = false) => {
    accesses.push({ name, kind, fileKind, file, line: node.loc?.start.line ?? 0, hasFallback });
  };

  visit(ast.program, [], (node, ancestors) => {
    if (!isProcessEnv(node)) return;

    let child: Node = node;
    let index = ancestors.length - 1;
    while (index >= 0 && TRANSPARENT.has(ancestors[index]!.type)) child = ancestors[index--]!;
    const parent = ancestors[index];
    const grandparent = ancestors[index - 1];

    if (parent && isMember(parent) && parent.object === child) {
      // Writes like `process.env.X = '1'` are not reads.
      if (grandparent?.type === 'AssignmentExpression' && grandparent.left === parent) return;
      const name = memberName(parent);
      if (name === undefined) return add('dynamic', parent);
      return add('inlined', parent, name, hasFallback(parent, ancestors.slice(0, index)));
    }

    if (parent?.type === 'VariableDeclarator' && parent.init === child) {
      if (parent.id.type === 'ObjectPattern') {
        for (const property of parent.id.properties) {
          if (property.type !== 'ObjectProperty') continue;
          const key = property.key;
          const name = key.type === 'Identifier' ? key.name : key.type === 'StringLiteral' ? key.value : undefined;
          add('destructure', property, name);
        }
        return;
      }
      return add('alias', parent);
    }

    add('whole', node);
  });

  return { accesses };
}

function visit(node: Node, ancestors: Node[], callback: (node: Node, ancestors: Node[]) => void): void {
  callback(node, ancestors);
  ancestors.push(node);
  for (const key of Object.keys(node) as (keyof Node)[]) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
    const value = node[key] as unknown;
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) visit(item, ancestors, callback);
    } else if (isNode(value)) {
      visit(value, ancestors, callback);
    }
  }
  ancestors.pop();
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

function isMember(node: Node): node is Extract<Node, { type: 'MemberExpression' | 'OptionalMemberExpression' }> {
  return node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression';
}

function isProcessEnv(node: Node): boolean {
  return (
    isMember(node) &&
    !node.computed &&
    node.object.type === 'Identifier' &&
    node.object.name === 'process' &&
    node.property.type === 'Identifier' &&
    node.property.name === 'env'
  );
}

/** Name read by `process.env.X` or `process.env['X']`; undefined for keys Babel can't inline. */
function memberName(member: Extract<Node, { type: 'MemberExpression' | 'OptionalMemberExpression' }>): string | undefined {
  if (!member.computed && member.property.type === 'Identifier') return member.property.name;
  if (member.computed && member.property.type === 'StringLiteral') return member.property.value;
  return undefined;
}

function hasFallback(member: Node, ancestors: Node[]): boolean {
  let child = member;
  let index = ancestors.length - 1;
  while (index >= 0 && TRANSPARENT.has(ancestors[index]!.type)) child = ancestors[index--]!;
  const parent = ancestors[index];
  return parent?.type === 'LogicalExpression' && parent.left === child && (parent.operator === '??' || parent.operator === '||');
}

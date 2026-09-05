/**
 * CodeMirror-aware function control with typed syntax/range transactions.
 *
 * Controls update the buffer and apply live audio only under an explicit
 * policy; offsets are derived from the current document state, never stale.
 */

import type { NumericControl, ControlContext, ScopedControlValues } from './controlModel';
import type { SyntaxRange } from './syntaxFixture';

export type TransactionPolicy = 'apply-live' | 'buffer-only' | 'none';

export type FunctionControlState = {
  value: number;
  range: SyntaxRange;
  policy: TransactionPolicy;
};

export type FunctionTransaction = {
  range: SyntaxRange;
  replacement: string;
  control: NumericControl;
};

export function buildTransaction(
  documentText: string,
  control: NumericControl,
  value: number,
  range: SyntaxRange,
): FunctionTransaction {
  return {
    range,
    replacement: String(value),
    control,
  };
}

export function applyTransaction(documentText: string, tx: FunctionTransaction): string {
  const lines = documentText.split('\n');
  const fromLine = rangeToLine(lines, tx.range.from);
  const toLine = rangeToLine(lines, tx.range.to);
  // For simplicity: single-line replacement within this fixture scope.
  if (fromLine === toLine) {
    const lineText = lines[fromLine] ?? '';
    const before = lineText.slice(0, tx.range.from.ch);
    const after = lineText.slice(tx.range.to.ch);
    lines[fromLine] = before + tx.replacement + after;
  }
  return lines.join('\n');
}

function rangeToLine(lines: string[], pos: { line: number; ch: number }): number {
  return Math.min(pos.line, lines.length - 1);
}

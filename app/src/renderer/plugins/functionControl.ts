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
  const lines = documentText.split('\n');
  const fromLine = rangeToLine(lines, range.from);
  const toLine = rangeToLine(lines, range.to);
  if (fromLine !== toLine) {
    throw new Error('Range must be on a single line');
  }
  const lineText = lines[fromLine] ?? '';
  if (range.from.ch < 0 || range.to.ch < 0 || range.from.ch > lineText.length || range.to.ch > lineText.length) {
    throw new Error('Range out of line bounds');
  }
  return {
    range,
    replacement: String(value),
    control,
  };
}

export function applyTransaction(documentText: string, tx: FunctionTransaction): string {
  const lines = documentText.split('\n');
  const fromLineNum = rangeToLine(lines, tx.range.from);
  const toLineNum = rangeToLine(lines, tx.range.to);
  if (fromLineNum !== toLineNum) {
    throw new Error('Multi-line replacements are not supported');
  }
  const lineText = lines[fromLineNum] ?? '';
  const clampedFromCh = Math.min(Math.max(0, tx.range.from.ch), lineText.length);
  const clampedToCh = Math.min(Math.max(0, tx.range.to.ch), lineText.length);
  const before = lineText.slice(0, clampedFromCh);
  const after = lineText.slice(clampedToCh);
  lines[fromLineNum] = before + tx.replacement + after;
  return lines.join('\n');
}

function rangeToLine(lines: string[], pos: { line: number; ch: number }): number {
  return Math.min(Math.max(0, pos.line), lines.length - 1);
}

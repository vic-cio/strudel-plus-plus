import { describe, expect, it } from 'vitest';
import { buildTransaction, applyTransaction } from './functionControl';
import type { NumericControl } from './controlModel';

const control: NumericControl = {
  kind: 'number',
  id: 'cutoff',
  label: 'cutoff',
  scope: { kind: 'session' },
  min: 0,
  max: 1,
  step: 0.01,
  defaultValue: 0.5,
};

describe('functionControl', () => {
  it('builds a transaction', () => {
    const tx = buildTransaction('x()', control, 0.75, { from: { line: 0, ch: 1 }, to: { line: 0, ch: 2 } });
    expect(tx.replacement).toBe('0.75');
  });

  it('applies transaction to document', () => {
    const documentText = 'cutoff(0)';
    const tx = buildTransaction(documentText, control, 0.9, { from: { line: 0, ch: 8 }, to: { line: 0, ch: 9 } });
    const result = applyTransaction(documentText, tx);
    expect(result).toContain('0.9');
  });
});

import { describe, expect, it } from 'vitest';
import {
  isControlScopeActive,
  pruneInactiveControls,
  validateControlValue,
  type NumericControl,
  type ScopedControlValues,
} from './controlModel';

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

describe('plugin control model', () => {
  it('keeps session controls active while beat/function ownership is explicit', () => {
    expect(isControlScopeActive({ kind: 'session' }, { beat: 'a.js', functionName: 'voice' })).toBe(true);
    expect(isControlScopeActive({ kind: 'beat', beat: 'a.js' }, { beat: 'a.js' })).toBe(true);
    expect(
      isControlScopeActive(
        { kind: 'function', beat: 'a.js', functionName: 'voice' },
        { beat: 'a.js', functionName: 'bass' },
      ),
    ).toBe(false);
  });

  it('removes function-scoped controls when their function changes', () => {
    const values: ScopedControlValues = {
      session: { value: 1, scope: { kind: 'session' } },
      voice: { value: 0.3, scope: { kind: 'function', beat: 'a.js', functionName: 'voice' } },
      bass: { value: 0.7, scope: { kind: 'function', beat: 'a.js', functionName: 'bass' } },
    };

    expect(pruneInactiveControls(values, { beat: 'a.js', functionName: 'bass' })).toEqual({
      session: values.session,
      bass: values.bass,
    });
  });

  it('rejects invalid numeric values at the control boundary', () => {
    expect(validateControlValue(control, Number.NaN)).toEqual({
      kind: 'invalid',
      message: 'cutoff must be a finite number',
    });
    expect(validateControlValue(control, 2)).toEqual({
      kind: 'invalid',
      message: 'cutoff must be between 0 and 1',
    });
    expect(validateControlValue(control, 0.75)).toEqual({ kind: 'valid', value: 0.75 });
  });
});

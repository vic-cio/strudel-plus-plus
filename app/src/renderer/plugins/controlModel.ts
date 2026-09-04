/**
 * The ownership of a control is part of its identity. Session controls are
 * safe to persist in the dock; beat and function controls are ephemeral and
 * must be retired when their owner is no longer active.
 */
export type ControlScope =
  | { kind: 'session' }
  | { kind: 'beat'; beat: string }
  | { kind: 'function'; beat: string; functionName: string };

export type ControlContext = {
  beat?: string;
  functionName?: string;
};

export type NumericControl = {
  kind: 'number';
  id: string;
  label: string;
  scope: ControlScope;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
};

export type ScopedControlValue = {
  value: number;
  scope: ControlScope;
};

export type ScopedControlValues = Record<string, ScopedControlValue>;

export type ControlValueResult = { kind: 'valid'; value: number } | { kind: 'invalid'; message: string };

export function isControlScopeActive(scope: ControlScope, context: ControlContext): boolean {
  switch (scope.kind) {
    case 'session':
      return true;
    case 'beat':
      return context.beat === scope.beat;
    case 'function':
      return context.beat === scope.beat && context.functionName === scope.functionName;
    default: {
      const _exhaustive: never = scope;
      return _exhaustive;
    }
  }
}

/** Remove values owned by a beat/function that is no longer active. */
export function pruneInactiveControls(values: ScopedControlValues, context: ControlContext): ScopedControlValues {
  return Object.fromEntries(
    Object.entries(values).filter(([, control]) => isControlScopeActive(control.scope, context)),
  );
}

export function validateControlValue(control: NumericControl, value: unknown): ControlValueResult {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { kind: 'invalid', message: `${control.label} must be a finite number` };
  }
  if (value < control.min || value > control.max) {
    return { kind: 'invalid', message: `${control.label} must be between ${control.min} and ${control.max}` };
  }
  return { kind: 'valid', value };
}

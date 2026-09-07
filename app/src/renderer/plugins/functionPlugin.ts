import { applyDelta, clampGeometry, defaultGeometry, type Geometry } from '../../shared/geometry';
import { applyTransaction, buildTransaction, positionToOffset, type DocumentChange } from './functionControl';
import { validateControlValue, type NumericControl } from './controlModel';
import type { SyntaxRange } from './syntaxFixture';
import type { FunctionPluginDef } from './registry';

export type FunctionPluginPlacement = { kind: 'floating'; geometry: Geometry } | { kind: 'docked'; paneIndex?: number };

export type FunctionPluginInstance = {
  instanceId: string;
  pluginId: string;
  beat: string;
  functionName: string;
  functionRange: SyntaxRange;
  range: SyntaxRange;
  value: number;
  placement: FunctionPluginPlacement;
};

export type FunctionPluginTarget = {
  pluginId: string;
  functionName: string;
  functionRange: SyntaxRange;
  range: SyntaxRange;
  value: number;
};

export type FunctionPluginValueChange = {
  source: string;
  instance: FunctionPluginInstance;
  change: DocumentChange;
};

type IdentifierSpan = { from: number; to: number; text: string };
type OffsetRange = { from: number; to: number };

const IDENTIFIER = /[A-Za-z0-9_$]/;
const NUMBER_LITERAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function identifierAt(source: string, offset: number): IdentifierSpan | undefined {
  if (!Number.isInteger(offset) || offset < 0 || offset > source.length) return undefined;
  let from = offset;
  let to = offset;
  if (from === source.length || !IDENTIFIER.test(source[from] ?? '')) {
    if (from === 0 || !IDENTIFIER.test(source[from - 1] ?? '')) return undefined;
    from -= 1;
    to = from + 1;
  }
  while (from > 0 && IDENTIFIER.test(source[from - 1] ?? '')) from -= 1;
  while (to < source.length && IDENTIFIER.test(source[to] ?? '')) to += 1;
  const text = source.slice(from, to);
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text) ? { from, to, text } : undefined;
}

function numericArgumentRange(source: string, openParen: number, argumentIndex: number): OffsetRange | undefined {
  let currentArgument = 0;
  let start = openParen + 1;
  let depth = 0;
  let quote: string | undefined;
  for (let index = start; index <= source.length; index += 1) {
    const character = source[index];
    if (quote !== undefined) {
      if (character === quote && source[index - 1] !== '\\') quote = undefined;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '(' || character === '[' || character === '{') {
      depth += 1;
      continue;
    }
    if (character === ')' || character === ']' || character === '}') {
      if (character === ')' && depth === 0) {
        if (currentArgument !== argumentIndex) return undefined;
        return trimNumericRange(source, start, index);
      }
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (character === ',' && depth === 0) {
      if (currentArgument === argumentIndex) return trimNumericRange(source, start, index);
      currentArgument += 1;
      start = index + 1;
    }
  }
  return undefined;
}

function trimNumericRange(source: string, from: number, to: number): OffsetRange | undefined {
  while (from < to && /\s/.test(source[from] ?? '')) from += 1;
  while (to > from && /\s/.test(source[to - 1] ?? '')) to -= 1;
  return NUMBER_LITERAL.test(source.slice(from, to)) ? { from, to } : undefined;
}

function offsetToPosition(source: string, offset: number): { line: number; ch: number } {
  const before = source.slice(0, offset);
  const lines = before.split('\n');
  return { line: lines.length - 1, ch: lines.at(-1)?.length ?? 0 };
}

export function resolveFunctionPluginTarget(
  source: string,
  offset: number,
  definitions: readonly FunctionPluginDef[],
): FunctionPluginTarget | undefined {
  const identifier = identifierAt(source, offset);
  if (!identifier) return undefined;
  const definition = definitions.find((candidate) => candidate.functionNames.includes(identifier.text));
  if (!definition) return undefined;
  let openParen = identifier.to;
  while (/\s/.test(source[openParen] ?? '')) openParen += 1;
  if (source[openParen] !== '(') return undefined;
  const argument = numericArgumentRange(source, openParen, definition.control.argumentIndex);
  if (!argument) return undefined;
  return {
    pluginId: definition.id,
    functionName: identifier.text,
    functionRange: {
      from: offsetToPosition(source, identifier.from),
      to: offsetToPosition(source, identifier.to),
    },
    range: { from: offsetToPosition(source, argument.from), to: offsetToPosition(source, argument.to) },
    value: Number(source.slice(argument.from, argument.to)),
  };
}

export function createFunctionPluginInstance(args: {
  beat: string;
  target: FunctionPluginTarget;
  x: number;
  y: number;
  viewport: { width: number; height: number };
}): FunctionPluginInstance {
  const { beat, target, x, y, viewport } = args;
  const geometry = clampGeometry({ ...defaultGeometry(280, 132, 100), x, y }, viewport);
  const location = `${target.range.from.line}:${target.range.from.ch}`;
  return {
    instanceId: `function:${beat}:${target.functionName}:${location}`,
    pluginId: target.pluginId,
    beat,
    functionName: target.functionName,
    functionRange: target.functionRange,
    range: target.range,
    value: target.value,
    placement: { kind: 'floating', geometry },
  };
}

export function moveFunctionPlugin(
  instance: FunctionPluginInstance,
  start: Geometry,
  delta: { x: number; y: number },
  viewport: { width: number; height: number },
): FunctionPluginInstance {
  if (instance.placement.kind !== 'floating') return instance;
  return {
    ...instance,
    placement: { kind: 'floating', geometry: clampGeometry(applyDelta(start, delta), viewport) },
  };
}

export function materializeFunctionControl(
  definition: FunctionPluginDef,
  instance: FunctionPluginInstance,
): NumericControl {
  const { argumentIndex: _, ...template } = definition.control;
  return { ...template, scope: { kind: 'function', beat: instance.beat, functionName: instance.functionName } };
}

export function applyFunctionPluginValue(args: {
  source: string;
  definition: FunctionPluginDef;
  instance: FunctionPluginInstance;
  value: number;
}): FunctionPluginValueChange {
  const control = materializeFunctionControl(args.definition, args.instance);
  const validated = validateControlValue(control, args.value);
  if (validated.kind === 'invalid') throw new Error(validated.message);
  const functionText = readRange(args.source, args.instance.functionRange);
  const argumentText = readRange(args.source, args.instance.range);
  if (
    functionText !== args.instance.functionName ||
    argumentText === undefined ||
    !NUMBER_LITERAL.test(argumentText) ||
    Number(argumentText) !== args.instance.value
  ) {
    throw new Error(`${args.instance.functionName}() no longer matches this plugin instance`);
  }
  const transaction = buildTransaction(args.source, control, validated.value, args.instance.range);
  const source = applyTransaction(args.source, transaction);
  return {
    source,
    instance: {
      ...args.instance,
      value: validated.value,
      range: {
        from: args.instance.range.from,
        to: { line: args.instance.range.from.line, ch: args.instance.range.from.ch + transaction.replacement.length },
      },
    },
    change: {
      from: positionToOffset(args.source, args.instance.range.from),
      to: positionToOffset(args.source, args.instance.range.to),
      insert: transaction.replacement,
      line: args.instance.range.from.line,
      fromCh: args.instance.range.from.ch,
      toCh: args.instance.range.to.ch,
    },
  };
}

export function rebaseFunctionPluginInstances(
  instances: readonly FunctionPluginInstance[],
  change: DocumentChange,
  changedInstanceId: string,
): FunctionPluginInstance[] {
  const delta = change.insert.length - (change.to - change.from);
  if (delta === 0) return [...instances];
  return instances.map((instance) => {
    if (instance.instanceId === changedInstanceId) return instance;
    return {
      ...instance,
      functionRange: shiftRange(instance.functionRange, change, delta),
      range: shiftRange(instance.range, change, delta),
    };
  });
}

function shiftRange(range: SyntaxRange, change: DocumentChange, delta: number): SyntaxRange {
  return {
    from: shiftPosition(range.from, change, delta),
    to: shiftPosition(range.to, change, delta),
  };
}

function shiftPosition(
  position: { line: number; ch: number },
  change: DocumentChange,
  delta: number,
): { line: number; ch: number } {
  if (position.line > change.line || (position.line === change.line && position.ch >= change.toCh)) {
    return position.line === change.line ? { ...position, ch: position.ch + delta } : position;
  }
  return position;
}

function readRange(source: string, range: SyntaxRange): string | undefined {
  if (range.from.line !== range.to.line) return undefined;
  const line = source.split('\n')[range.from.line];
  if (line === undefined || range.from.ch < 0 || range.to.ch < range.from.ch || range.to.ch > line.length) {
    return undefined;
  }
  return line.slice(range.from.ch, range.to.ch);
}

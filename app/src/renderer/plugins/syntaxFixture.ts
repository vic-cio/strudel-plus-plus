/**
 * Syntax fixtures for typed function-range transactions.
 */

export type SyntaxRange = {
  from: { line: number; ch: number };
  to: { line: number; ch: number };
};

export type SyntaxFixture = {
  source: string;
  ranges: SyntaxRange[];
  label: string;
};

export const FIXTURES: SyntaxFixture[] = [
  {
    label: 'simple function',
    source: 'function voice() { s("bd") }',
    ranges: [{ from: { line: 0, ch: 9 }, to: { line: 0, ch: 13 } }],
  },
  {
    label: 'nested call',
    source: 'voice(s("sn"))',
    ranges: [{ from: { line: 0, ch: 0 }, to: { line: 0, ch: 4 } }],
  },
];

export function findRange(source: string, target: string): SyntaxRange | undefined {
  const index = source.indexOf(target);
  if (index < 0) return undefined;
  const before = source.slice(0, index);
  const line = before.split('\n').length - 1;
  const ch = before.split('\n').pop()!.length;
  return { from: { line, ch }, to: { line, ch: ch + target.length } };
}

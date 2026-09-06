import { describe, expect, it } from 'vitest';
import { FIXTURES, findRange } from './syntaxFixture';

describe('syntaxFixture', () => {
  it('finds simple function range', () => {
    const r = findRange('function voice() { s("bd") }', 'voice');
    expect(r).toBeDefined();
  });

  it('loads fixtures', () => {
    expect(FIXTURES.length).toBeGreaterThan(0);
  });
});

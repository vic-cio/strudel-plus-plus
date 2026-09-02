import { describe, expect, it } from 'vitest';
import { STARTER_BEAT } from './starterBeat';

describe('STARTER_BEAT', () => {
  it('is the captain-approved new beat template', () => {
    expect(STARTER_BEAT).toBe(`// a new beat

stack(
  s("bd*2, ~ sd"),
  s("hh*8").gain(0.4),
)
`);
    expect(STARTER_BEAT).not.toContain('setcps');
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// gm_* soundfont instruments fetch their data from felixroos.github.io at
// runtime (@strudel/soundfonts' fontloader.mjs); without it in the CSP the
// fetch is silently blocked and the instrument resolves to silence instead
// of an audible error.
describe('renderer CSP', () => {
  const html = readFileSync(resolve(__dirname, 'index.html'), 'utf-8');
  const cspMatch = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  if (!cspMatch) {
    throw new Error('CSP meta tag not found in index.html');
  }
  const csp = cspMatch[1];

  it('allows the soundfont data host', () => {
    expect(csp).toContain('https://felixroos.github.io');
  });

  it('allows the soundfont player source host, scoped to felixroos', () => {
    expect(csp).toContain('https://github.com/felixroos/');
  });

  it('keeps the existing sample CDN allowed', () => {
    expect(csp).toContain('https://strudel.b-cdn.net');
  });
});

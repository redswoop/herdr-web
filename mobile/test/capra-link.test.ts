import { describe, expect, it } from 'vitest';
import { looksLikeCapraLink, parseCapraLink } from '../src/capra-link';

describe('parseCapraLink', () => {
  it('reads the deep link', () => {
    expect(parseCapraLink('capra://settings?server=https%3A%2F%2Fblackstar.ts.net&name=blackstar&token=abc')).toEqual({
      server: 'https://blackstar.ts.net',
      token: 'abc',
      name: 'blackstar',
    });
  });
  it('reads the clickable https form', () => {
    expect(parseCapraLink('https://stormer.ts.net/link?token=xyz')).toEqual({ server: 'https://stormer.ts.net', token: 'xyz', name: null });
    expect(parseCapraLink(' https://stormer.ts.net:8443/link/?token=xyz&name=canary ')).toEqual({ server: 'https://stormer.ts.net:8443', token: 'xyz', name: 'canary' });
  });
  it('tolerates a server-only deep link', () => {
    expect(parseCapraLink('capra://settings?server=https://h.ts.net/')).toEqual({ server: 'https://h.ts.net', token: null, name: null });
  });
  it('rejects plain URLs and junk', () => {
    expect(parseCapraLink('https://stormer.ts.net')).toBeNull();
    expect(parseCapraLink('https://stormer.ts.net/api/roster?token=x')).toBeNull();
    expect(parseCapraLink('capra://settings?token=only')).toBeNull();
    expect(parseCapraLink('')).toBeNull();
    expect(parseCapraLink('not a url')).toBeNull();
  });
  it('knows a link from a typed host', () => {
    expect(looksLikeCapraLink('capra://settings?server=x')).toBe(true);
    expect(looksLikeCapraLink('https://h.ts.net/link?token=1')).toBe(true);
    expect(looksLikeCapraLink('https://h.ts.net')).toBe(false);
  });
});

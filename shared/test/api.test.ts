import { describe, expect, it, beforeEach } from 'vitest';
import { apiUrl, configureApi, getApiConfig } from '../src/api';

describe('apiUrl', () => {
  beforeEach(() => {
    configureApi({ baseUrl: '', token: null });
  });

  it('returns relative path by default', () => {
    expect(apiUrl('/api/roster')).toBe('/api/roster');
  });

  it('prefixes baseUrl', () => {
    configureApi({ baseUrl: 'https://host.ts.net' });
    expect(apiUrl('/api/roster')).toBe('https://host.ts.net/api/roster');
  });

  it('appends token', () => {
    configureApi({ token: 'sec ret' });
    expect(apiUrl('/api/roster')).toBe('/api/roster?token=sec%20ret');
    expect(apiUrl('/api/x?offset=1')).toBe('/api/x?offset=1&token=sec%20ret');
  });

  it('strips trailing slash on baseUrl', () => {
    configureApi({ baseUrl: 'https://h/' });
    expect(getApiConfig().baseUrl).toBe('https://h');
  });
});

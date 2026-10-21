import { describe, expect, it, beforeEach } from 'vitest';
import { apiUrl, configureApi, describeError, getApiConfig } from '../src/api';

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

describe('describeError', () => {
  beforeEach(() => {
    configureApi({ baseUrl: '', token: null });
  });

  it('collapses an iOS offline error to the host', () => {
    configureApi({ baseUrl: 'https://stormer.tail93d23c.ts.net' });
    expect(
      describeError(
        new TypeError(
          'fetch failed: UnexpectedException: The Internet connection appears to be offline. (at ExpoModulesCore/Promise.swift:56)',
        ),
      ),
    ).toBe("can't reach stormer.tail93d23c.ts.net");
  });

  it('names no host on web', () => {
    expect(describeError(new TypeError('Network request failed'))).toBe("can't reach the server");
    expect(describeError(new TypeError('Load failed'))).toBe("can't reach the server");
  });

  it('strips native wrappers from other errors', () => {
    expect(describeError(new Error('fetch failed: UnexpectedException: boom (at ExpoModulesCore/Promise.swift:56)'))).toBe('boom');
  });

  it('passes server messages through', () => {
    expect(describeError(new Error('pane not found'))).toBe('pane not found');
    expect(describeError('plain string')).toBe('plain string');
    expect(describeError(undefined)).toBe('something went wrong');
  });
});

import { describe, expect, it, beforeEach } from 'vitest';
import { agentPath, apiUrl, configureApi, configureServers, describeError, getApiConfig, hostName, hostOf, hostPath, joinHost, splitHost } from '../src/api';

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
    configureApi({ baseUrl: 'https://desk.tailnet.ts.net' });
    expect(
      describeError(
        new TypeError(
          'fetch failed: UnexpectedException: The Internet connection appears to be offline. (at ExpoModulesCore/Promise.swift:56)',
        ),
      ),
    ).toBe("can't reach desk.tailnet.ts.net");
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

describe('multi-host routing', () => {
  beforeEach(() => {
    configureServers([
      { id: 'stormer', name: 'stormer', baseUrl: 'https://stormer.ts.net', token: 'tok-s' },
      { id: 'blackstar', name: 'blackstar', baseUrl: 'https://blackstar.ts.net', token: 'tok-b' },
    ]);
  });

  it('splits and joins host suffixes', () => {
    expect(splitHost('w19:p1@blackstar')).toEqual({ local: 'w19:p1', host: 'blackstar' });
    expect(splitHost('w19:p1')).toEqual({ local: 'w19:p1', host: null });
    expect(joinHost('w19:p1', 'blackstar')).toBe('w19:p1@blackstar');
    expect(joinHost('w19:p1', null)).toBe('w19:p1');
    expect(hostOf('w1:p1@blackstar')).toBe('blackstar');
    expect(hostOf('w1:p1')).toBeNull();
  });

  it("the primary's own slug never becomes a suffix (native seeds spawns with servers[0].id)", () => {
    // the roster leaves primary ids bare; a spawn joined with the primary's
    // slug must produce the same id or the agent screen can't find it
    expect(joinHost('w1:p1', 'stormer')).toBe('w1:p1');
    expect(joinHost('w1:p1', 'blackstar')).toBe('w1:p1@blackstar');
    expect(joinHost('w1:p1', '')).toBe('w1:p1');
  });

  it('an unknown host routes nowhere, not to the primary', () => {
    // a removed server's pane id must not land on the primary's pane with the same local id
    expect(agentPath('w1:p1@gone', 'prompt')).toBe('/api/agent/w1%3Ap1/prompt');
    expect(apiUrl('/api/chats', 'gone')).toBe('/api/chats');
    expect(hostName('gone')).toBe('');
  });

  it('routes a bare pane id to the primary, relative', () => {
    expect(agentPath('w2Y:p3', 'prompt')).toBe('/api/agent/w2Y%3Ap3/prompt');
    expect(apiUrl(agentPath('w2Y:p3', 'prompt'))).toBe('https://stormer.ts.net/api/agent/w2Y%3Ap3/prompt?token=tok-s');
  });

  it('routes an @host pane id to that server with its own token', () => {
    const p = agentPath('w19:p1@blackstar', 'stream');
    expect(p).toBe('https://blackstar.ts.net/api/agent/w19%3Ap1/stream');
    expect(apiUrl(`${p}?offset=3`)).toBe('https://blackstar.ts.net/api/agent/w19%3Ap1/stream?offset=3&token=tok-b');
  });

  it('never appends a token twice', () => {
    const once = apiUrl('/api/roster', 'blackstar');
    expect(apiUrl(once)).toBe(once);
  });

  it('picks the server for a bare path by host', () => {
    expect(apiUrl('/api/projects', 'blackstar')).toBe('https://blackstar.ts.net/api/projects?token=tok-b');
    expect(apiUrl('/api/projects')).toBe('https://stormer.ts.net/api/projects?token=tok-s');
    expect(hostPath('/api/chats', 'blackstar')).toBe('https://blackstar.ts.net/api/chats');
    expect(hostPath('/api/chats', null)).toBe('/api/chats');
  });

  it('leaves a foreign absolute URL alone', () => {
    expect(apiUrl('https://example.com/x')).toBe('https://example.com/x');
  });

  it('names the host in errors', () => {
    expect(describeError(new TypeError('Network request failed'), 'blackstar')).toBe("can't reach blackstar.ts.net");
    expect(hostName('blackstar')).toBe('blackstar');
    expect(hostName(null)).toBe('stormer');
  });
});

describe('host colours', () => {
  it('uses the stored pick, else the palette by position', async () => {
    const { HOST_PALETTE, hostColor } = await import('../src/api');
    configureServers([
      { id: 'stormer', name: 'stormer', baseUrl: 'https://stormer.ts.net', token: null },
      { id: 'blackstar', name: 'blackstar', baseUrl: 'https://blackstar.ts.net', token: null, color: '#123456' },
    ]);
    expect(hostColor(null)).toBe(HOST_PALETTE[0]!.hex);
    expect(hostColor('stormer')).toBe(HOST_PALETTE[0]!.hex);
    expect(hostColor('blackstar')).toBe('#123456');
    expect(hostColor('nope')).toBe(HOST_PALETTE[0]!.hex); // unknown → primary
  });
});

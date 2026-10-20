import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildPlaces,
  buildSpawnRequest,
  describeDest,
  initialDest,
  lastMode,
  placeDest,
  rememberMode,
  spawnModeArgs,
} from '../src/launcher';
import { setPlatform } from '../src/platform';
import type { Agent, Project, Roster, Workspace } from '../src/types';

const kv = new Map<string, string>();
beforeEach(() => {
  kv.clear();
  setPlatform({
    openSse: () => { throw new Error('no sse in tests'); },
    kv: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v), remove: (k) => void kv.delete(k) },
    onWake: () => () => {},
    isForeground: () => true,
    notifyError: () => {},
  });
});

const agent = (p: Partial<Agent> & { paneId: string; workspaceId: string; cwd: string }): Agent => ({
  tabId: `${p.workspaceId}:t1`,
  agent: 'claude',
  displayAgent: null,
  label: null,
  title: p.paneId,
  status: 'idle',
  repoRoot: p.cwd,
  focused: false,
  launchPending: false,
  stateLabels: {},
  revision: 1,
  hasTranscript: true,
  sessionId: null,
  lastActiveAt: 0,
  ...p,
});
const ws = (workspaceId: string, number: number, label = ''): Workspace => ({
  workspaceId,
  number,
  label,
  focused: false,
  status: 'idle',
  worktree: null,
});
const project = (path: string, extra: Partial<Project> = {}): Project => ({
  key: path,
  path,
  name: path.split('/').pop()!,
  repo: true,
  live: 0,
  lastActive: 0,
  dirs: [path],
  ...extra,
});

const roster: Roster = {
  agents: [
    agent({ paneId: 'w1:p1', workspaceId: 'w1', cwd: '/home/a/src/herdr', lastActiveAt: 500 }),
    agent({ paneId: 'w1:p2', workspaceId: 'w1', cwd: '/home/a/src/herdr', lastActiveAt: 900 }),
    agent({ paneId: 'w2:p1', workspaceId: 'w2', cwd: '/home/a/src/comfy', lastActiveAt: 100 }),
  ],
  workspaces: [ws('w1', 1, 'herdr'), ws('w2', 2)],
  updatedAt: 1,
};

describe('buildPlaces', () => {
  it('folds agents and spaces into places, busiest first', () => {
    const places = buildPlaces(roster, [project('/home/a/src/herdr'), project('/home/a/src/comfy'), project('/home/a/src', { repo: false })]);
    expect(places.map((p) => p.name)).toEqual(['herdr', 'comfy']); // ~/src is a cold container → dropped
    expect(places[0].live).toBe(2);
    expect(places[0].lastActive).toBe(900);
    expect(places[0].spaces.map((w) => w.workspaceId)).toEqual(['w1']);
  });
  it('keeps a cold project that contains nothing else', () => {
    const places = buildPlaces({ agents: [], updatedAt: 1 }, [project('/home/a/notes', { lastActive: 5 })]);
    expect(places.map((p) => p.name)).toEqual(['notes']);
  });
  it('names the home dir ~', () => {
    const places = buildPlaces({ agents: [agent({ paneId: 'x', workspaceId: 'w9', cwd: '/home/a', repoRoot: null })], updatedAt: 1 }, null);
    expect(places[0].name).toBe('~');
  });
});

describe('placeDest / initialDest', () => {
  it('aims at the busiest live space, else a fresh one', () => {
    const places = buildPlaces(roster, null);
    expect(placeDest(places[0], roster)).toEqual({ type: 'workspace', workspaceId: 'w1', cwd: '/home/a/src/herdr' });
    expect(placeDest({ ...places[0], spaces: [] }, roster)).toEqual({ type: 'project', path: '/home/a/src/herdr' });
  });
  it('honours a space target, then a cwd target, then the top place', () => {
    expect(initialDest(roster, { workspaceId: 'w2' })).toEqual({ type: 'workspace', workspaceId: 'w2', cwd: undefined });
    expect(initialDest(roster, { cwd: '/home/a/src/comfy' })).toEqual({ type: 'workspace', workspaceId: 'w2', cwd: '/home/a/src/comfy' });
    expect(initialDest(roster, { cwd: '/tmp/new' })).toEqual({ type: 'project', path: '/tmp/new' });
    expect(initialDest(roster, undefined).type).toBe('workspace');
    expect(initialDest({ agents: [], updatedAt: 1 }, undefined)).toEqual({ type: 'path' });
  });
});

describe('describeDest', () => {
  it('says where and how', () => {
    const places = buildPlaces(roster, null);
    const d = describeDest({ type: 'workspace', workspaceId: 'w1' }, roster, places, '');
    expect(d.name).toBe('herdr');
    expect(d.how).toBe('new tab in its space');
    expect(describeDest({ type: 'path' }, roster, places, '').name).toBe('~');
    expect(describeDest({ type: 'resume', dir: '/x', sessionId: 'abcdef0123', title: null, kind: 'pi' }, roster, places, '')).toMatchObject({ name: 'abcdef01', how: 'resume · pi' });
  });
});

describe('spawn modes', () => {
  it('maps the ladder per kind', () => {
    expect(spawnModeArgs('claude', 'yolo')).toEqual(['--dangerously-skip-permissions']);
    expect(spawnModeArgs('grok', 'yolo')).toEqual(['--always-approve']);
    expect(spawnModeArgs('codex', 'plan')).toEqual(['--sandbox', 'read-only', '--ask-for-approval', 'on-request']);
    expect(spawnModeArgs('claude', 'default')).toEqual([]);
  });
  it('remembers per kind through platform.kv', () => {
    expect(lastMode('claude')).toBe('default');
    rememberMode('claude', 'plan');
    expect(lastMode('claude')).toBe('plan');
    expect(lastMode('grok')).toBe('default');
    kv.set('herdr.spawnMode.grok', 'bogus');
    expect(lastMode('grok')).toBe('default');
  });
});

describe('buildSpawnRequest', () => {
  const base = { kind: 'claude', spawnMode: 'plan' as const, name: '', argsText: '', cwd: '', branch: '' };
  it('joins a space with the mode args', () => {
    expect(buildSpawnRequest({ ...base, dest: { type: 'workspace', workspaceId: 'w1', cwd: '/h' } })).toEqual({
      kind: 'claude',
      name: undefined,
      label: undefined,
      args: ['--permission-mode', 'plan'],
      workspaceId: 'w1',
      cwd: '/h',
    });
  });
  it('resumes without a mode and inherits the title', () => {
    expect(buildSpawnRequest({ ...base, dest: { type: 'resume', dir: '/h', sessionId: 's1', title: 'old chat', kind: 'claude' } })).toEqual({
      kind: 'claude',
      name: 'old chat',
      label: 'old chat',
      args: undefined,
      cwd: '/h',
      resume: 's1',
    });
  });
  it('needs a branch for a new worktree and splits extra args', () => {
    expect(buildSpawnRequest({ ...base, dest: { type: 'worktree-new', repoCwd: '/r' } })).toEqual({ error: 'branch name required for a new worktree' });
    const r = buildSpawnRequest({ ...base, spawnMode: 'default', argsText: '--resume  abc', dest: { type: 'worktree-new', repoCwd: '/r' }, branch: 'feat' });
    expect(r).toMatchObject({ args: ['--resume', 'abc'], worktree: { repoCwd: '/r', branch: 'feat' } });
  });
  it('pi gets no mode args; custom path falls back to ~', () => {
    expect(buildSpawnRequest({ ...base, kind: 'pi', dest: { type: 'path' } })).toMatchObject({ kind: 'pi', args: undefined, cwd: undefined });
  });
});

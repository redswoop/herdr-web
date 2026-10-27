import { describe, expect, it } from 'vitest';
import { buildGroups, byAttention, byGroupRank, chipName, cleanAgentName, dominant, isGenericTitle } from '../src/roster-groups';
import type { Agent } from '../src/types';

const agent = (partial: Partial<Agent> & { paneId: string }): Agent => ({
  workspaceId: 'ws1',
  tabId: 't1',
  agent: 'claude',
  displayAgent: 'Claude Code',
  label: null,
  title: partial.paneId,
  status: 'idle',
  cwd: '/home/a',
  repoRoot: '/home/a',
  focused: false,
  launchPending: false,
  stateLabels: {},
  revision: 1,
  hasTranscript: true,
  sessionId: null,
  ...partial,
});

describe('buildGroups', () => {
  it('groups by workspace', () => {
    const agents = [
      agent({ paneId: 'p1', workspaceId: 'ws1' }),
      agent({ paneId: 'p2', workspaceId: 'ws2' }),
    ];
    const groups = buildGroups(
      agents,
      [
        {
          workspaceId: 'ws1',
          number: 1,
          label: 'main',
          focused: true,
          status: 'idle',
          worktree: null,
        },
        {
          workspaceId: 'ws2',
          number: 2,
          label: 'other',
          focused: false,
          status: 'idle',
          worktree: null,
        },
      ],
      [],
      'workspace',
    );
    expect(groups).toHaveLength(2);
    expect(groups[0].title).toBe('main');
    expect(groups[0].agents).toHaveLength(1);
  });
});

describe('dominant / cleanAgentName', () => {
  it('dominant picks majority', () => {
    const agents = [
      agent({ paneId: '1', cwd: '/a' }),
      agent({ paneId: '2', cwd: '/a' }),
      agent({ paneId: '3', cwd: '/b' }),
    ];
    expect(dominant(agents, (a) => a.cwd)).toBe('/a');
  });
  it('cleanAgentName sanitizes', () => {
    expect(cleanAgentName('Hello World!!')).toBe('hello-world');
  });
});

describe('chipName', () => {
  it('skips the server-minted auto label for the agent title', () => {
    const a = agent({ paneId: 'w33:p7', label: 'claude-w33p7', title: 'Web UI space grouping' });
    expect(chipName(a)).toBe('Web UI space grouping');
  });

  it('keeps a human label over everything', () => {
    const a = agent({ paneId: 'w33:p7', label: 'grouping-redo', title: 'Web UI space grouping' });
    expect(chipName(a)).toBe('grouping-redo');
  });

  it('falls back to the session title when the terminal title is generic', () => {
    const a = agent({
      paneId: 'w38:p1',
      agent: 'pi',
      displayAgent: 'pi',
      cwd: '/mnt/data/ComfyData',
      title: 'π - ComfyData',
      sessionTitle: 'Wan LoRA sweep',
      firstPrompt: 'look at the sweep',
    });
    expect(chipName(a)).toBe('Wan LoRA sweep');
  });

  it('then the first line of the first prompt', () => {
    const a = agent({ paneId: 'p1', title: 'Claude Code', firstPrompt: 'fix the grouping\nmore detail' });
    expect(chipName(a)).toBe('fix the grouping');
  });

  it('treats path-ish titles as generic', () => {
    expect(isGenericTitle('~/src/herdr-web', agent({ paneId: 'p1' }))).toBe(true);
    expect(isGenericTitle('Regenerating Emmy catsuit variant', agent({ paneId: 'p1' }))).toBe(false);
  });

  it('ends at the auto label when nothing better exists', () => {
    const a = agent({ paneId: 'w1:p2', label: 'claude-w1p2', title: '' });
    expect(chipName(a)).toBe('claude-w1p2');
  });
});

describe('recency ordering', () => {
  const now = 10 * 86_400_000;
  it('recent mode: blocked, working, then newest; stale folds', () => {
    const agents = [
      agent({ paneId: 'old', lastActiveAt: now - 3 * 86_400_000 }),
      agent({ paneId: 'new', lastActiveAt: now - 60_000 }),
      agent({ paneId: 'mid', lastActiveAt: now - 3_600_000 }),
      agent({ paneId: 'busy', status: 'working', lastActiveAt: now - 7_200_000 }),
      agent({ paneId: 'help', status: 'blocked', lastActiveAt: now - 5 * 86_400_000 }),
    ];
    const [live, stale] = buildGroups(agents, [], [], 'recent', now);
    expect(live.flat).toBe(true);
    expect(live.agents.map((a) => a.paneId)).toEqual(['help', 'busy', 'new', 'mid']);
    expect(stale.defaultClosed).toBe(true);
    expect(stale.agents.map((a) => a.paneId)).toEqual(['old']);
  });

  it('cards: freshest project beats a crowd of idle ones, rows newest-first', () => {
    const card = (key: string, agents: Agent[]) => ({ key, agents: [...agents].sort(byAttention) });
    const cards = [
      card('crowd', [
        agent({ paneId: 'c1', lastActiveAt: now - 86_400_000 }),
        agent({ paneId: 'c2', lastActiveAt: now - 7_200_000 }),
        agent({ paneId: 'c3', lastActiveAt: now - 3_600_000 }),
      ]),
      card('fresh', [agent({ paneId: 'f1', lastActiveAt: now - 60_000 })]),
      card('busy', [agent({ paneId: 'b1', status: 'working', lastActiveAt: now - 86_400_000 })]),
    ].sort(byGroupRank);
    expect(cards.map((c) => c.key)).toEqual(['busy', 'fresh', 'crowd']);
    expect(cards[2].agents.map((a) => a.paneId)).toEqual(['c3', 'c2', 'c1']);
  });

  it('space mode: busiest space first, empties last, unnamed tabs never split', () => {
    const ws = (id: string, number: number) => ({
      workspaceId: id, number, label: id, focused: false, status: 'idle' as const, worktree: null,
    });
    const tabs = [
      { tabId: 'a1', workspaceId: 'A', number: 1, label: '1', focused: false, paneCount: 1 },
      { tabId: 'a2', workspaceId: 'A', number: 2, label: '2', focused: false, paneCount: 1 },
    ];
    const groups = buildGroups(
      [
        agent({ paneId: 'p1', workspaceId: 'A', tabId: 'a1', lastActiveAt: now - 9_000_000 }),
        agent({ paneId: 'p2', workspaceId: 'A', tabId: 'a2', lastActiveAt: now - 8_000_000 }),
        agent({ paneId: 'p3', workspaceId: 'B', lastActiveAt: now - 1_000 }),
      ],
      [ws('A', 1), ws('B', 2), ws('C', 3)],
      tabs as never,
      'workspace',
      now,
    );
    expect(groups.map((g) => g.key)).toEqual(['B', 'A', 'C']);
    expect(groups[1].subs).toBeUndefined();
  });

  it('space mode: same-named spaces get their number as a badge', () => {
    const ws = (id: string, number: number) => ({
      workspaceId: id, number, label: '~', focused: false, status: 'idle' as const, worktree: null,
    });
    const groups = buildGroups(
      [agent({ paneId: 'p1', workspaceId: 'A' }), agent({ paneId: 'p2', workspaceId: 'B' })],
      [ws('A', 6), ws('B', 8)],
      [],
      'workspace',
      now,
    );
    expect(groups.map((g) => g.badge).sort()).toEqual(['#6', '#8']);
  });
});

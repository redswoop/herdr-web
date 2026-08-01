import { describe, expect, it } from 'vitest';
import { buildGroups, cleanAgentName, dominant } from '../src/roster-groups';
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

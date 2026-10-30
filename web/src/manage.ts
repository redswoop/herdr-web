/* Rename / close for agents and workspaces — the TUI's verbs, reached from a
   sidebar/overview row's ⋯ menu (or right-click), a workspace header, and the
   agent header's name. Same verbs and wording as Capra's mobile/src/manage.ts;
   the browser's own prompt/confirm, like Capra's native sheets: quick and
   keyboard-correct. */
import {
  chipName,
  closeAgent,
  closeWorkspace,
  describeError,
  errorOf,
  renameAgent,
  renameWorkspace,
  type Agent,
} from '@herdr/shared';
import type { MenuItem } from './components/ui/ContextMenu';

async function run(p: Promise<Response>): Promise<boolean> {
  try {
    const r = await p;
    if (!r.ok) throw new Error(await errorOf(r));
    return true;
  } catch (e) {
    alert(`herdr said no: ${describeError(e)}`);
    return false;
  }
}

/** rename with the text given (header inline edit) — a no-op when unchanged */
export function renameAgentTo(a: Agent, text: string): Promise<boolean> {
  const name = text.trim();
  if (!name || name === chipName(a)) return Promise.resolve(false);
  return run(renameAgent(a.paneId, name));
}

export function agentMenuItems(a: Agent, opts: { onClosed?: () => void } = {}): MenuItem[] {
  const name = chipName(a);
  return [
    {
      label: 'Rename…',
      run: () => {
        const t = prompt('Rename — the tab and the agent both take the new name.', name);
        if (t != null) void renameAgentTo(a, t);
      },
    },
    {
      label: a.status === 'working' ? 'Close agent (it is working)' : 'Close agent',
      danger: true,
      run: async () => {
        if (!confirm(`Close ${name}?\n\nEnds the agent and its pane. The session file stays on disk for /resume.`)) return;
        if (await run(closeAgent(a.paneId))) opts.onClosed?.();
      },
    },
  ];
}

export function workspaceMenuItems(workspaceId: string, title: string, agentCount: number): MenuItem[] {
  return [
    {
      label: 'Rename space…',
      run: () => {
        const t = prompt('Rename space — herdr shows this on the workspace tab.', title)?.trim();
        if (t && t !== title) void run(renameWorkspace(workspaceId, t));
      },
    },
    {
      label: agentCount ? `Close space (${agentCount} agent${agentCount === 1 ? '' : 's'})` : 'Close space',
      danger: true,
      run: () => {
        if (!confirm(`Close ${title}?\n\nEvery pane in it ends. Session files stay on disk for /resume.`)) return;
        void run(closeWorkspace(workspaceId));
      },
    },
  ];
}

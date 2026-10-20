import { useCallback, useEffect, useRef, useState } from 'react';
import { agentPath, get, post } from '../api';
import { LIVE_MODE_KINDS } from '../modes';
import { getPlatform } from '../platform';
import type { AgentStatus, ModeState, PermissionMode } from '../types';

/**
 * Claude's permission mode (footer-parsed server-side). Fetches on mount and
 * on status transitions — answers can change the mode underneath us (a plan
 * approval leaves plan mode, "allow all edits" flips to acceptEdits). While
 * the agent works, LiveTail's screen poll feeds `accept` for free.
 */
export function useAgentMode(
  paneId: string,
  agentKind: string | undefined,
  status: AgentStatus | undefined,
) {
  const live = !!agentKind && LIVE_MODE_KINDS.includes(agentKind);
  const [mode, setModeState] = useState<ModeState>('unknown');
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    if (!live) return;
    const mySeq = ++seq.current;
    try {
      const r = await get(agentPath(paneId, 'mode'));
      if (!r.ok) return;
      const { mode: m } = (await r.json()) as { mode?: ModeState };
      if (mySeq === seq.current) setModeState(m ?? 'unknown');
    } catch {
      // transient — the next status flip retries
    }
  }, [paneId, live]);

  useEffect(() => {
    seq.current += 1;
    setModeState('unknown');
    void refresh();
  }, [paneId, refresh]);

  useEffect(() => {
    void refresh();
  }, [status, refresh]);

  /** LiveTail piggyback — a fresher read than any pending fetch */
  const accept = useCallback((m: ModeState) => {
    seq.current += 1;
    setModeState(m ?? 'unknown');
  }, []);

  const setMode = useCallback(
    async (target: PermissionMode) => {
      setBusy(true);
      try {
        const r = await post(agentPath(paneId, 'mode'), { mode: target });
        const body = (await r.json().catch(() => ({}))) as { error?: string; mode?: ModeState };
        if (!r.ok) {
          getPlatform().notifyError(body.error ?? r.statusText);
          if (body.mode) accept(body.mode);
          return false;
        }
        accept(body.mode ?? target);
        return true;
      } finally {
        setBusy(false);
      }
    },
    [paneId, accept],
  );

  return { mode: live ? mode : ('unknown' as ModeState), busy, setMode, accept, refresh };
}

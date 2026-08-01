import { useCallback, useEffect, useRef, useState } from 'react';
import { agentPath, post } from '../api';
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
  const isClaude = agentKind === 'claude';
  const [mode, setModeState] = useState<ModeState>('unknown');
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    if (!isClaude) return;
    const mySeq = ++seq.current;
    try {
      const r = await fetch(agentPath(paneId, 'mode'));
      if (!r.ok) return;
      const { mode: m } = await r.json();
      if (mySeq === seq.current) setModeState(m ?? 'unknown');
    } catch {}
  }, [paneId, isClaude]);

  useEffect(() => {
    seq.current += 1;
    setModeState('unknown');
    refresh();
  }, [paneId, refresh]);

  useEffect(() => {
    refresh();
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
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
          alert(body.error ?? r.statusText);
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

  return { mode: isClaude ? mode : ('unknown' as ModeState), busy, setMode, accept, refresh };
}

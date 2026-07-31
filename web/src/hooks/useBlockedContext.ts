import { useCallback, useEffect, useRef, useState } from 'react';
import { agentPath } from '../api';
import type { AgentStatus, BlockedCtx } from '../types';

/** What is the agent blocked on? null while not blocked / loading. */
export function useBlockedContext(paneId: string, status: AgentStatus | undefined) {
  const [ctx, setCtx] = useState<BlockedCtx | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const mySeq = ++seq.current;
    let next: BlockedCtx;
    try {
      const r = await fetch(agentPath(paneId, 'blocked-context'));
      next = await r.json();
    } catch {
      next = { kind: 'unknown' };
    }
    if (mySeq === seq.current) setCtx(next);
  }, [paneId]);

  useEffect(() => {
    if (status !== 'blocked') {
      seq.current += 1; // invalidate any in-flight fetch
      setCtx(null);
      return;
    }
    refresh();
  }, [status, refresh]);

  return { ctx, refresh };
}

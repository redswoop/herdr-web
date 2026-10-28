/* Command deck: the per-kind session controls (new / rewind / compact /
   effort …) the adapter reports on /api/kinds, plus the header readout
   (model · effort · context) derived from the transcript itself. Shared by
   the web F-bar and the Capra strip. */
import { useEffect, useState } from 'react';
import { get } from './api';
import type { AgentKind, CommandVerb, Item, KindCommand } from './types';

/** Fixed slot order — a verb a kind lacks still holds its slot (dimmed), so
 *  the numbers stay muscle memory across agents. */
export const DECK_VERBS: CommandVerb[] = ['new', 'rewind', 'resume', 'compact', 'effort', 'perms', 'model', 'context'];

// one /api/kinds fetch per host for the life of the page — manifests only
// change when the daemon is upgraded, and a reload picks that up
const kindsCache = new Map<string, Promise<AgentKind[]>>();

function fetchKinds(host: string | null | undefined): Promise<AgentKind[]> {
  const k = host ?? '';
  let p = kindsCache.get(k);
  if (!p) {
    p = get('/api/kinds', host)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((j: { kinds: AgentKind[] }) => j.kinds ?? []);
    // a failed fetch must not poison the cache — the next mount retries
    p.catch(() => kindsCache.delete(k));
    kindsCache.set(k, p);
  }
  return p;
}

/** The deck for one agent kind on one host; [] while loading or unsupported. */
export function useKindCommands(kind: string | undefined, host?: string | null): KindCommand[] {
  const [cmds, setCmds] = useState<KindCommand[]>([]);
  useEffect(() => {
    if (!kind) return setCmds([]);
    let dead = false;
    fetchKinds(host)
      .then((kinds) => {
        if (!dead) setCmds(kinds.find((k) => k.kind === kind)?.commands ?? []);
      })
      .catch(() => {
        if (!dead) setCmds([]);
      });
    return () => {
      dead = true;
    };
  }, [kind, host]);
  return cmds;
}

/** The slash text a deck entry fires, or null when it's a client panel. */
export function commandText(cmd: KindCommand, value?: string): string | null {
  if (!cmd.send) return null;
  const v = value?.trim();
  return v ? `${cmd.send} ${v}` : cmd.send;
}

export interface SessionReadout {
  /** model id as the API reported it (claude-opus-5-5) */
  model: string | null;
  effort: string | null;
  /** context tokens at the newest turn */
  ctx: number | null;
}

// claude's /effort stdout: "Set effort level to low (saved as your default
// for new sessions): …" (interactive); "Effort level set to …" (headless)
const EFFORT_SET_RE = /^(?:Set effort level to|Effort level set to) (\w+)/;

/**
 * Newest model / effort / context size in the transcript. Assistant records
 * carry all three; an `/effort` change shows up first as its stdout (the
 * next assistant record confirms it), so whichever is newer wins.
 */
export function sessionReadout(items: Item[]): SessionReadout {
  const out: SessionReadout = { model: null, effort: null, ctx: null };
  // a compaction newer than the last turn makes its context size stale —
  // blank until the next turn reports the real one
  let ctxDone = false;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const it = items[i];
    if (it.type !== 'event') continue;
    const ev = it.ev;
    if (ev.kind === 'note' && ev.name === 'compact') ctxDone = true;
    if (out.effort == null && ev.kind === 'command_out') {
      const m = EFFORT_SET_RE.exec(ev.text);
      if (m) out.effort = m[1];
    }
    if (out.model == null && ev.model) out.model = ev.model;
    if (out.effort == null && ev.effort) out.effort = ev.effort;
    if (!ctxDone && ev.usage) {
      out.ctx = ev.usage.ctx;
      ctxDone = true;
    }
    if (out.model != null && out.effort != null && ctxDone) break;
  }
  return out;
}

/** claude-opus-5-5 → "opus 5.5"; claude-sonnet-4-5-20250929 → "sonnet 4.5". */
export function shortModel(id: string | null | undefined): string | null {
  if (!id) return null;
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?/.exec(id);
  if (!m) return id;
  return m[3] ? `${m[1]} ${m[2]}.${m[3]}` : `${m[1]} ${m[2]}`;
}

/** 98038 → "98k", 1_204_000 → "1.2M" */
export function fmtTokens(n: number | null | undefined): string | null {
  if (n == null) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

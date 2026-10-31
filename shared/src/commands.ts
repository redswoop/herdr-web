/* Session controls: the per-kind verbs (new / rewind / compact / effort …)
   the adapter reports on /api/kinds, plus the header readout (model ·
   effort · context) derived from the transcript itself. Shared by the web
   and Capra status lines, where each readout is the control that changes it. */
import { useEffect, useState } from 'react';
import { get } from './api';
import type { AgentKind, Item, KindCommand } from './types';

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
  /** context window size, once a `/context` in this session has said it */
  window: number | null;
}

// claude's /effort stdout: "Set effort level to low (saved as your default
// for new sessions): …" (interactive); "Effort level set to …" (headless)
const EFFORT_SET_RE = /^(?:Set effort level to|Effort level set to) (\w+)/;
// …and /model's: "Set model to `Sonnet 5.5` and saved as your default …"
const MODEL_SET_RE = /^Set model to `?([A-Za-z]+) (\d+)(?:\.(\d+))?/;
// …and /context's: "33.5k/1m tokens (3%)" — the only place the window shows
const CTX_WINDOW_RE = /\b[\d.]+[km]\/([\d.]+)([km]) tokens\b/i;

/**
 * Newest model / effort / context size in the transcript. Assistant records
 * carry all three; an `/effort` change shows up first as its stdout (the
 * next assistant record confirms it), so whichever is newer wins.
 */
export function sessionReadout(items: Item[]): SessionReadout {
  const out: SessionReadout = { model: null, effort: null, ctx: null, window: null };
  // a compaction newer than the last turn makes its context size stale —
  // blank until the next turn reports the real one
  let ctxDone = false;
  // a model switch newer than any effort report resets effort to that
  // model's own default — unknown until the next turn says
  let effortDone = false;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const it = items[i];
    if (it.type !== 'event') continue;
    const ev = it.ev;
    if (ev.kind === 'note' && ev.name === 'compact') ctxDone = true;
    if (ev.kind === 'command_out') {
      const e = !effortDone && EFFORT_SET_RE.exec(ev.text);
      if (e) {
        out.effort = e[1];
        effortDone = true;
      }
      const m = out.model == null && MODEL_SET_RE.exec(ev.text);
      if (m) {
        out.model = `claude-${m[1].toLowerCase()}-${m[2]}${m[3] ? `-${m[3]}` : ''}`;
        effortDone = true;
      }
      const w = out.window == null && CTX_WINDOW_RE.exec(ev.text);
      if (w) out.window = Math.round(Number(w[1]) * (w[2].toLowerCase() === 'm' ? 1_000_000 : 1000));
    }
    if (out.model == null && ev.model) out.model = ev.model;
    if (!effortDone && ev.effort) {
      out.effort = ev.effort;
      effortDone = true;
    }
    if (!ctxDone && ev.usage) {
      out.ctx = ev.usage.ctx;
      ctxDone = true;
    }
    if (out.model != null && effortDone && ctxDone && out.window != null) break;
  }
  return out;
}

/** How full the window is, 0–1; null until a `/context` has named the window. */
export function ctxFill(r: SessionReadout): number | null {
  if (r.ctx == null || !r.window) return null;
  return Math.min(1, r.ctx / r.window);
}

/** The status line's fill tint: '' (plenty), 'warm' (≥60%), 'hot' (≥85%). */
export function ctxHeat(r: SessionReadout): '' | 'warm' | 'hot' {
  const f = ctxFill(r);
  return f == null ? '' : f >= 0.85 ? 'hot' : f >= 0.6 ? 'warm' : '';
}

/** The pick-list value the session is on now, marked in the deck's picker. */
export function currentValue(cmd: KindCommand, r: SessionReadout): string | null {
  if (cmd.verb === 'effort') return r.effort;
  // model values are claude's aliases (opus, sonnet …) — match the family
  if (cmd.verb === 'model') return cmd.values?.find((v) => r.model?.startsWith(`claude-${v}-`)) ?? null;
  return null;
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

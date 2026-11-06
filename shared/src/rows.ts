// Attention rows: the things that want a human, as sentences addressed to
// them. Derived from the signal store + roster on the client so the home
// page, a chat, and Capra all show the same row for the same fact.
import type { Agent, Roster, Signal, SignalState, SignalTone } from './types';
import { chipName } from './roster-groups';

export const toneOf = (state: SignalState | undefined): SignalTone =>
  state === 'needs-you' ? 'needs-you' : state === 'alarm' || state === 'down' ? 'broken' : state === 'busy' ? 'working' : null;

/** the only three glyphs a human has to learn */
export const TONE_GLYPH: Record<Exclude<SignalTone, null>, string> = { 'needs-you': '✋', broken: '✕', working: '▶' };

export interface Provenance {
  /** the session this came from, in the human's words; null when unknown */
  label: string | null;
  paneId: string | null;
  /** the session is still on the roster (so a pill can open it) */
  live: boolean;
  /** the directory it was launched from, short */
  where: string | null;
}

export interface AttentionRow {
  key: string;
  sig: Signal;
  tone: Exclude<SignalTone, null>;
  title: string;
  from: Provenance;
  /** epoch ms the fact became true (finished / started / updated) */
  at: number | null;
  meaning: string | null;
  commitsSince: number | null;
  /** old, unowned, and the repo has moved on: show it, but not as news */
  stale: boolean;
  actions: string[];
  help: Record<string, string>;
}

const STALE_MS = 24 * 3600_000;
const basename = (p: string) => p.replace(/\/$/, '').split('/').pop() || p;

export function sessionName(a: Agent): string {
  return chipName(a);
}

export function provenanceOf(sig: Signal, roster: Roster | null): Provenance {
  const at = sig.attach;
  const agents = roster?.agents ?? [];
  let a: Agent | undefined;
  if (at?.paneId) a = agents.find((x) => x.paneId === at.paneId);
  if (!a && at?.cwd) {
    const cwd = at.cwd.replace(/\/$/, '');
    a = agents.find((x) => (x.cwd ?? '').replace(/\/$/, '') === cwd)
      ?? agents.find((x) => x.repoRoot && cwd.startsWith(x.repoRoot));
  }
  if (a) return { label: sessionName(a), paneId: a.paneId, live: true, where: a.cwd ? basename(a.cwd) : null };
  return { label: null, paneId: null, live: false, where: at?.cwd ? basename(at.cwd) : sig.host || null };
}

/** the rows for a surface: all of them (home), or the ones a chat owns */
export function attentionRows(
  snap: { signals: Signal[] },
  roster: Roster | null,
  opts: { now?: number; paneId?: string | null; includeStale?: boolean } = {},
): AttentionRow[] {
  const now = opts.now ?? Date.now();
  const out: AttentionRow[] = [];
  for (const sig of snap.signals) {
    if (sig.source === 'herd' || sig.source === 'scene') continue;
    if (sig.key.replace(/@[^@/]*$/, '') === 'gaffer:board') continue;
    const tone = sig.tone ?? toneOf(sig.state);
    if (tone !== 'needs-you' && tone !== 'broken') continue;
    const from = provenanceOf(sig, roster);
    if (opts.paneId && from.paneId !== opts.paneId && sig.attach?.paneId !== opts.paneId) continue;
    const at = sig.finishedAt ?? sig.startedAt ?? sig.updatedAt ?? null;
    const stale = tone === 'broken' && !from.live && at != null && now - at > STALE_MS;
    if (stale && !opts.includeStale) continue;
    out.push({
      key: sig.key,
      sig,
      tone,
      title: sig.title,
      from,
      at,
      meaning: sig.meaning ?? null,
      commitsSince: sig.commitsSince ?? null,
      stale,
      actions: sig.actions ?? [],
      help: sig.actionHelp ?? {},
    });
  }
  const rank: Record<string, number> = { 'needs-you': 0, broken: 1, working: 2 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone] || (b.at ?? 0) - (a.at ?? 0));
}

/** rows that were filtered out as stale, for the count behind the jobs cell */
export function staleRows(snap: { signals: Signal[] }, roster: Roster | null, now = Date.now()): AttentionRow[] {
  return attentionRows(snap, roster, { now, includeStale: true }).filter((r) => r.stale);
}

import { useMemo, useState, type ReactNode } from 'react';
import { attentionRows, staleRows, toneOf, TONE_GLYPH } from '@herdr/shared';
import { AttentionRow, LogTail } from './AttentionRow';
import { useSeen } from '../hooks/useSeen';
import { useEffect } from 'react';
import { bySource } from '../hooks/useSignals';
import { Sparkline } from './ui/Sparkline';
import type { Agent, Roster, Signal, SignalItem, SignalSnapshot, SignalState } from '../types';
import { agoShort } from '../util';

// The deck: what the herd kicked off and what it leans on, as tiles. Pure
// view over the signal store (hooks/useSignals) — no fetching here, no
// per-service knowledge beyond "which tile does this source render into".

const fmtBytes = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return '?';
  const a = Math.abs(n);
  if (a >= 1e12) return `${(n / 1e12).toFixed(2)} TB`;
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
  return `${Math.round(n / 1e3)} kB`;
};
const fmtDur = (s: number | null | undefined) => {
  if (s == null || !Number.isFinite(s) || s < 0) return '?';
  if (s < 90) return `${Math.round(s)}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  if (s < 172_800) return `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`;
  return `${Math.round(s / 86_400)}d`;
};

/** a key without its `@host` suffix (multi-host merges qualify keys) */
const baseKey = (k: string) => k.replace(/@[^@/]*$/, '');
const RANK: Record<SignalState, number> = { 'needs-you': 0, alarm: 1, down: 2, warn: 3, busy: 4, ok: 5, idle: 6 };
const worst = (list: Signal[]): SignalState =>
  list.reduce<SignalState>((w, s) => (RANK[s.state] < RANK[w] ? s.state : w), 'idle');

/** glyph for a state: one of three, or nothing (plain is plain) */
const glyph = (state: SignalState | undefined) => { const t = toneOf(state); return t ? TONE_GLYPH[t] : ''; };

function Tile({ title, state, right, children, className }: { title: string; state: SignalState; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`stile st-${state} ${className ?? ''}`}>
      <header className="stile-head">
        <span className={`stile-glyph st-${state}`}>{glyph(state)}</span>
        <span className="stile-title">{title}</span>
        <span className="stile-right sub">{right}</span>
      </header>
      {children}
    </section>
  );
}

function Bar({ pct, state }: { pct: number | null | undefined; state?: SignalState }) {
  const p = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <span className={`sbar st-${state ?? 'ok'}`} role="progressbar" aria-valuenow={p}>
      <span className="sbar-fill" style={{ width: `${p}%` }} />
    </span>
  );
}

/** The verbs of a job. `log` is not a verb: it opens the tail inline. */
function Verbs({ s, roster, onSelect, act }: { s: Signal; roster: Roster; onSelect: (p: string) => void; act: (key: string, action: string) => Promise<unknown> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const go = async (a: string) => {
    if (a === 'cancel' && !confirm(`cancel "${s.title}"?`)) return;
    if (a === 'log' && log != null) { setLog(null); return; }
    setBusy(a); setErr(null);
    try {
      const r = await act(s.key, a);
      if (a === 'log') setLog(String((r as { text?: string })?.text ?? '').trimEnd() || '(empty log)');
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  };
  if (!s.actions?.length && !s.attach) return null;
  return (
    <>
      <span className="job-actions">
        <SessionChip sig={s} roster={roster} onSelect={onSelect} />
        {s.actions?.map((a) => (
          <button key={a} className={`sig-act act-${a} ${a === 'log' && log != null ? 'on' : ''}`} disabled={busy != null} onClick={() => go(a)}>
            {busy === a ? '…' : a}
          </button>
        ))}
        {err && <span className="sig-err">{err}</span>}
      </span>
      {log != null && <LogTail text={log} />}
    </>
  );
}

/** session link for a signal that knows its cwd/pane */
function sessionFor(sig: Signal, roster: Roster): Agent | undefined {
  const a = sig.attach;
  if (!a) return undefined;
  if (a.paneId) return roster.agents.find((x) => x.paneId === a.paneId);
  if (a.cwd) {
    const cwd = a.cwd.replace(/\/$/, '');
    return roster.agents.find((x) => (x.cwd ?? '').replace(/\/$/, '') === cwd)
      ?? roster.agents.find((x) => x.repoRoot && cwd.startsWith(x.repoRoot));
  }
  return undefined;
}

function SessionChip({ sig, roster, onSelect }: { sig: Signal; roster: Roster; onSelect: (paneId: string) => void }) {
  const a = sessionFor(sig, roster);
  if (!a) return null;
  return (
    <button className="sig-session" title={`started from ${a.cwd ?? ''}`} onClick={() => onSelect(a.paneId)}>
      ↗ {a.label ?? a.sessionTitle ?? a.paneId}
    </button>
  );
}

// ---------- disk ----------

/** the sentence a disk tile opens with: what is moving and when it matters */
function diskAnswer(list: Signal[]): string {
  const moving = list.filter((s) => Math.abs(s.rate ?? 0) > 2e6);
  const down = list.filter((s) => s.state === 'down');
  const low = list.filter((s) => s.state === 'alarm' || s.state === 'warn');
  const bits: string[] = [];
  for (const d of down) bits.push(`${shortMount(d.title)} unreachable`);
  for (const d of moving) {
    const r = d.rate ?? 0;
    if (r < 0 && d.value != null) bits.push(`${shortMount(d.title)} filling ${fmtBytes(-r * 60)}/min, empty in ${fmtDur(d.value / -r)}`);
    else bits.push(`${shortMount(d.title)} freeing ${fmtBytes(r * 60)}/min`);
  }
  for (const d of low) if (!moving.includes(d) && !down.includes(d)) bits.push(`${shortMount(d.title)} low: ${fmtBytes(d.value)} left`);
  return bits.length ? bits.join(' · ') : 'nothing moving';
}

function DiskTile({ list }: { list: Signal[] }) {
  if (!list.length) return null;
  return (
    <Tile title="disk" state={worst(list)} right={list.length > 1 ? `${list.length} volumes` : undefined} className="stile-disk">
      <div className="stile-answer">{diskAnswer(list)}</div>
      {list.map((s) => {
        const rate = s.rate ?? 0;
        const moving = Math.abs(rate) > 2e6;
        return (
          <div key={s.key} className={`disk-row st-${s.state}`}>
            <div className="disk-line">
              <span className="disk-name">{s.title}</span>
              <span className={`disk-free ${moving ? (rate > 0 ? 'up' : 'down') : ''}`}>
                {s.state === 'down' ? 'unreachable' : `${fmtBytes(s.value)} free`}
              </span>
              <span className="sub disk-total">{s.total ? `of ${fmtBytes(s.total)}` : ''}</span>
            </div>
            <Bar pct={s.pct} state={s.state} />
            {moving && s.history && s.history.length > 2 && (
              <Sparkline points={s.history} className={rate > 0 ? 'up' : 'down'} />
            )}
            <div className="sub disk-detail">{s.detail?.replace(/^[^·]*free of [^·]*(· )?/, '') || (s.remote ? 'nas' : ' ')}</div>
          </div>
        );
      })}
    </Tile>
  );
}

// ---------- gpu + host ----------

/** can I start GPU work now, and what would it evict? */
function gpuAnswer(local: Signal[], jobs: Signal[]): string {
  const g = local[0];
  if (!g) return '';
  const render = jobs.find((j) => j.needs === 'gpu' && (j.jobState === 'running' || j.jobState === 'yielded'));
  if (render) return `${render.jobState === 'yielded' ? 'yielded' : 'rendering'}: ${render.title}${render.eta ? ` · ~${fmtDur(render.eta)} left` : ''}`;
  const free = g.mem ? (g.mem.total - g.mem.used) / 1024 : null;
  const top = g.items?.[0];
  const mib = top ? Number((top.sub ?? '').replace(/\D/g, '')) : 0;
  const holder = top ? `${top.label} holds ${mib >= 1024 ? `${(mib / 1024).toFixed(0)} GB` : `${mib} MB`}` : 'nobody on it';
  if (free == null) return holder;
  return `${free.toFixed(0)} GB free · ${holder}${(g.value ?? 0) < 5 && top ? ' · idle' : ''}`;
}

function GpuTile({ local, remote, sys, jobs }: { local: Signal[]; remote: Signal[]; sys: Signal[]; jobs: Signal[] }) {
  if (!local.length && !remote.length && !sys.length) return null;
  const all = [...local, ...remote];
  return (
    <Tile title="compute" state={worst([...all, ...sys])} className="stile-gpu">
      <div className="stile-answer">{gpuAnswer(local, jobs)}</div>
      {local.map((g) => (
        <div key={g.key} className="gpu-row">
          <div className="gpu-line">
            <span className="gpu-name">{g.title}</span>
            <span className="gpu-util">{g.value ?? 0}%</span>
            <span className="sub">{g.mem ? `${(g.mem.used / 1024).toFixed(1)} / ${(g.mem.total / 1024).toFixed(0)} GB` : ''}{g.temp != null ? ` · ${g.temp}°` : ''}{g.power != null ? ` · ${g.power} W` : ''}</span>
          </div>
          <Bar pct={g.mem ? (g.mem.used / g.mem.total) * 100 : g.pct} state={g.state} />
          {g.history && <Sparkline points={g.history} floor={0} ceil={100} height={22} />}
          {!!g.items?.length && (
            <div className="sub gpu-holders">{g.items.slice(0, 4).map((i) => `${i.label} ${i.sub?.replace(' MiB', 'M') ?? ''}`).join(' · ')}</div>
          )}
        </div>
      ))}
      {remote.filter((h) => !h.self).map((h) => (
        <div key={h.key} className={`gpu-row remote st-${h.state}`}>
          <div className="gpu-line">
            <span className="gpu-name">{h.title}</span>
            <span className="gpu-util">{h.state === 'down' ? 'offline' : h.mem ? `${(h.mem.used / 1024).toFixed(1)} / ${(h.mem.total / 1024).toFixed(0)} GB` : ''}</span>
            <span className="sub">{h.state === 'down' ? h.detail : h.items?.slice(0, 2).map((i) => i.label).join(' · ')}</span>
          </div>
          {h.state !== 'down' && <Bar pct={h.pct} state={h.state} />}
        </div>
      ))}
      {sys.length > 0 && (
        <div className="sys-row">
          {sys.map((s) => (
            <div key={s.key} className={`sys-cell st-${s.state}`} title={s.detail}>
              <span className="sys-name sub">{s.title}</span>
              <span className="sys-val">{s.value ?? '?'}%</span>
              {s.history && <Sparkline points={s.history} floor={0} ceil={100} height={18} />}
            </div>
          ))}
        </div>
      )}
    </Tile>
  );
}

// ---------- jobs (gaffer + pushed) ----------

function JobRow({ s, roster, onSelect, act }: { s: Signal; roster: Roster; onSelect: (p: string) => void; act: (key: string, action: string) => Promise<unknown> }) {
  const n = s.done != null && s.total ? `${Math.round(s.done)}/${Math.round(s.total)}${s.unit ? ` ${s.unit}` : ''}` : s.pct != null ? `${s.pct}%` : '';
  return (
    <div className={`job st-${s.state}`}>
      <div className="job-line">
        <span className={`stile-glyph st-${s.state}`}>{glyph(s.state)}</span>
        <span className="job-title" title={s.title}>{s.title}</span>
        <span className="sub job-meta">{s.sub}{s.host ? ` · ${s.host}` : ''}</span>
      </div>
      {s.state === 'busy' && (s.pct != null || s.done != null) && <Bar pct={s.pct} state={s.state} />}
      <div className="job-foot sub">
        <span className="job-n">{n}</span>
        <span className="job-detail">{s.detail}</span>
        {s.eta != null && s.state === 'busy' && <span className="job-eta">~{fmtDur(s.eta)}</span>}
        {s.state !== 'busy' && (s.finishedAt || s.startedAt) && (
          <span className="job-eta">{s.runMs != null ? `ran ${fmtDur(s.runMs / 1000)}` : ''}{s.finishedAt ? ` · ${agoShort(s.finishedAt)}` : s.startedAt ? ` · since ${agoShort(s.startedAt)}` : ''}</span>
        )}
      </div>
      <Verbs s={s} roster={roster} onSelect={onSelect} act={act} />
    </div>
  );
}

function JobsTile({ jobs, board, pushed, roster, onSelect, act }: { jobs: Signal[]; board: Signal | undefined; pushed: Signal[]; roster: Roster; onSelect: (p: string) => void; act: (key: string, action: string) => Promise<unknown> }) {
  const [showDone, setShowDone] = useState(false);
  if (!jobs.length && !board && !pushed.length) return null;
  const all = [...jobs, ...pushed];
  const done = board?.items ?? [];
  return (
    <Tile title="jobs" state={worst(all.length ? all : board ? [board] : [])} right={board?.detail} className="stile-jobs">
      {all.map((s) => <JobRow key={s.key} s={s} roster={roster} onSelect={onSelect} act={act} />)}
      {!all.length && <div className="sub stile-empty">nothing else running</div>}
      {done.length > 0 && (
        <details className="stile-more" open={showDone} onToggle={(e) => setShowDone((e.currentTarget as HTMLDetailsElement).open)}>
          <summary className="sub">{done.length} finished lately</summary>
          <ItemList items={done} />
        </details>
      )}
    </Tile>
  );
}

// ---------- lists ----------

function ItemList({ items, max = 12 }: { items: SignalItem[]; max?: number }) {
  return (
    <ul className="sig-items">
      {items.slice(0, max).map((i) => (
        <li key={i.id} className={`st-${i.state ?? 'ok'}`}>
          <span className={`stile-glyph st-${i.state ?? 'ok'}`}>{i.color ? <span className="swatch" style={{ background: i.color }} /> : glyph(i.state)}</span>
          {i.href ? <a className="sig-item-label" href={i.href} target="_blank" rel="noreferrer">{i.label}</a> : <span className="sig-item-label">{i.label}</span>}
          {i.pct != null && <Bar pct={i.pct} state={i.state} />}
          {i.sub && <span className="sub sig-item-sub">{i.sub}</span>}
        </li>
      ))}
    </ul>
  );
}

function DownloadsTile({ queue, history, act }: { queue?: Signal; history?: Signal; act: (key: string, action: string) => Promise<unknown> }) {
  if (!queue) return null;
  const busy = queue.state === 'busy';
  return (
    <Tile
      title="downloads"
      state={queue.state}
      right={queue.href ? <a href={queue.href} target="_blank" rel="noreferrer">{queue.host || 'sab'} ↗</a> : queue.host}
      className="stile-dl"
    >
      <div className="dl-line">
        <span className={`dl-speed ${busy ? 'busy' : ''}`}>{busy ? `${fmtBytes(queue.value)}/s` : queue.items?.length ? 'paused' : 'idle'}</span>
        <span className="sub">{queue.detail}</span>
        {!!queue.actions?.length && queue.actions.map((a) => (
          <button key={a} className={`sig-act act-${a}`} onClick={() => act(queue.key, a)}>{a}</button>
        ))}
      </div>
      {busy && queue.history && <Sparkline points={queue.history} floor={0} height={22} />}
      {!!queue.items?.length && <ItemList items={queue.items} />}
      {history && history.items && history.items.length > 0 && (
        <details className="stile-more">
          <summary className="sub">{history.detail}</summary>
          <ItemList items={history.items.map((i) => ({ ...i, sub: `${i.sub ?? ''}${i.at ? ` · ${agoShort(i.at)}` : ''}` }))} max={6} />
        </details>
      )}
    </Tile>
  );
}

function PrinterRow({ s, act }: { s: Signal; act: (key: string, action: string) => Promise<unknown> }) {
  const t = s.temps;
  const temp = t && t.nozzle != null ? `${Math.round(t.nozzle)}°${t.nozzleTarget ? `/${Math.round(t.nozzleTarget)}` : ''}` : '';
  const trays = (s.items ?? []).filter((i) => i.id.startsWith('ams:') || i.id === 'ext');
  const hms = (s.items ?? []).filter((i) => i.id.startsWith('hms:'));
  return (
    <div className={`job prn st-${s.state}`}>
      <div className="job-line">
        <span className={`stile-glyph st-${s.state}`}>{glyph(s.state)}</span>
        <span className="job-title" title={s.title}>{s.title}</span>
        <span className="sub job-meta">{s.sub}</span>
        {!!s.actions?.length && s.actions.map((a) => (
          <button key={a} className={`sig-act act-${a}`} title={s.actionHelp?.[a]} onClick={() => act(s.key, a)}>{a}</button>
        ))}
      </div>
      {(s.state === 'busy' || s.state === 'needs-you') && s.pct != null && <Bar pct={s.pct} state={s.state} />}
      <div className="job-foot sub">
        <span className="job-n">{s.pct != null && s.state !== 'idle' ? `${s.pct}%` : ''}</span>
        <span className="job-detail">{s.detail}</span>
        {s.eta != null && s.state === 'busy' && <span className="job-eta">~{fmtDur(s.eta)}</span>}
        {s.state !== 'busy' && s.finishedAt && <span className="job-eta">{agoShort(s.finishedAt)}</span>}
      </div>
      <div className="prn-temps sub">
        {temp && <span>nozzle {temp}</span>}
        {t && t.bed != null && <span>bed {Math.round(t.bed)}°{t.bedTarget ? `/${Math.round(t.bedTarget)}` : ''}</span>}
        {t && t.chamber != null && t.chamber > 5 && <span>chamber {Math.round(t.chamber)}°</span>}
        {s.wifi && <span>wifi {s.wifi}</span>}
      </div>
      {hms.some((i) => i.state === 'alarm') && <ItemList items={hms.filter((i) => i.state === 'alarm')} />}
      {hms.some((i) => i.state !== 'alarm') && (
        <details className="stile-more">
          <summary className="sub">{hms.length} HMS{hms.some((i) => i.state === 'warn') ? ` · ${hms.filter((i) => i.state === 'warn').length} serious` : ''}</summary>
          <ItemList items={hms.filter((i) => i.state !== 'alarm')} max={20} />
        </details>
      )}
      {trays.length > 0 && (
        <details className="stile-more">
          <summary className="sub">{s.feeding ? `feeding ${s.feeding.type ?? '?'}${s.feeding.remain != null && s.feeding.remain >= 0 ? ` · ${s.feeding.remain}% left` : ''}` : `${trays.length} trays`}</summary>
          <ItemList items={trays} max={20} />
        </details>
      )}
    </div>
  );
}

function PrintersTile({ list, act }: { list: Signal[]; act: (key: string, action: string) => Promise<unknown> }) {
  if (!list.length) return null;
  return (
    <Tile title="printers" state={worst(list)} className="stile-prn">
      {list.map((s) => <PrinterRow key={s.key} s={s} act={act} />)}
    </Tile>
  );
}

function ServicesTile({ list }: { list: Signal[] }) {
  if (!list.length) return null;
  const state = worst(list);
  const bad = list.flatMap((s) => (s.items ?? []).filter((i) => i.state === 'down' || i.state === 'warn'));
  const up = list.reduce((n, s) => n + (s.items ?? []).filter((i) => i.state === 'ok').length, 0);
  const answer = bad.length
    ? `${bad.map((i) => `${i.label}${i.state === 'down' ? ' down' : i.sub ? ` ${i.sub}` : ''}`).join(' · ')} · ${up} up`
    : `all ${up} up`;
  return (
    <Tile title="services" state={state} right={list.map((s) => `${s.items?.filter((i) => i.state === 'ok' || i.state === 'warn').length ?? 0} ${s.title}`).join(' · ')} className="stile-svc">
      <div className="stile-answer">{answer}</div>
      {list.map((s) => {
        const bad = (s.items ?? []).filter((i) => i.state === 'down' || i.state === 'warn');
        return (
          <div key={s.key} className="svc-group">
            {bad.length > 0 && <ItemList items={bad} />}
            <details className="stile-more">
              <summary className="sub">{s.title}: {s.detail}</summary>
              <ItemList items={(s.items ?? []).filter((i) => !bad.includes(i))} max={40} />
            </details>
          </div>
        );
      })}
    </Tile>
  );
}

// ---------- the deck: one btop row, attention lines, detail on demand ----------

type Section = 'jobs' | 'disk' | 'compute' | 'downloads' | 'printers' | 'services';
const OPEN_KEY = 'herdr.deckOpen';
const loadOpen = (): Section | null => {
  try { const v = localStorage.getItem(OPEN_KEY); return v && v !== 'open' && v !== 'closed' ? (v as Section) : null; } catch { return null; }
};

const shortMount = (t: string) => (t === '/' ? '/' : t.replace(/^\/mnt\//, '').replace(/^\/home\/[^/]+/, '~'));
const shortG = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return '?';
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e10) return `${Math.round(n / 1e9)}G`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}G`;
  return `${Math.round(n / 1e6)}M`;
};

function Cell({ id, state, open, onOpen, title, children }: { id: Section; state: SignalState; open: boolean; onOpen: (s: Section) => void; title?: string; children: ReactNode }) {
  return (
    <button className={`scell st-${state} ${toneOf(state) ? '' : 'rest'} ${open ? 'open' : ''}`} onClick={() => onOpen(id)} title={title} aria-expanded={open}>
      {children}
    </button>
  );
}

const Spk = ({ points, floor, ceil }: { points?: [number, number][]; floor?: number; ceil?: number }) =>
  points && points.length > 1 ? <Sparkline points={points} floor={floor} ceil={ceil} height={14} className="scell-spark" /> : <span className="scell-spark" />;

export function Deck({
  snap,
  live,
  roster,
  onSelect,
  act,
}: {
  snap: SignalSnapshot;
  live: boolean;
  roster: Roster;
  onSelect: (paneId: string) => void;
  act: (key: string, action: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState<Section | null>(loadOpen);
  const toggle = (s: Section) => setOpen((cur) => {
    const next = cur === s ? null : s;
    try { localStorage.setItem(OPEN_KEY, next ?? ''); } catch {}
    return next;
  });
  const parts = useMemo(() => {
    const gaffer = bySource(snap, 'gaffer');
    const jobs = [...gaffer.filter((s) => s.kind === 'job'), ...bySource(snap, 'push')];
    return {
      disk: bySource(snap, 'disk'),
      gpu: bySource(snap, 'gpu'),
      sys: bySource(snap, 'sys'),
      hosts: gaffer.filter((s) => s.key.startsWith('gaffer:host:') && !s.self),
      jobs,
      board: gaffer.find((s) => baseKey(s.key) === 'gaffer:board'),
      pushed: bySource(snap, 'push'),
      sabQueue: snap.signals.find((s) => baseKey(s.key) === 'sab:queue'),
      sabHistory: snap.signals.find((s) => baseKey(s.key) === 'sab:history'),
      printers: bySource(snap, 'bambu'),
      services: bySource(snap, 'services'),
      rows: attentionRows(snap, roster),
      stale: staleRows(snap, roster),
    };
  }, [snap, roster]);
  const inRows = new Set([...parts.rows, ...parts.stale].map((r) => r.key));
  const failing = snap.sources.filter((s) => s.ok === false);
  const fresh = useSeen(useMemo(() => parts.rows.map((r) => ({ id: r.key, version: String(r.at ?? 0) })), [parts.rows]));

  // keyboard: j/k walk the rows, Enter opens, a/r fire ack/retry on the focused row, 1-5 open cells
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const bodies = [...document.querySelectorAll<HTMLButtonElement>('.deck .arow-body')];
      const i = bodies.findIndex((b) => b === document.activeElement);
      if (e.key === 'j' || e.key === 'k') {
        if (!bodies.length) return;
        const n = e.key === 'j' ? Math.min(bodies.length - 1, i + 1) : Math.max(0, i - 1);
        bodies[n].focus(); e.preventDefault();
      } else if ((e.key === 'a' || e.key === 'r') && i >= 0) {
        const verb = e.key === 'a' ? 'ack' : 'retry';
        const btn = bodies[i].parentElement?.querySelector<HTMLButtonElement>(`.sig-act.act-${verb}`);
        if (btn) { btn.click(); e.preventDefault(); }
      } else if (/^[1-6]$/.test(e.key)) {
        const order: Section[] = ['jobs', 'disk', 'compute', 'downloads', 'printers', 'services'];
        toggle(order[Number(e.key) - 1]); e.preventDefault();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const cpu = parts.sys.find((s) => s.key.endsWith(':cpu'));
  const mem = parts.sys.find((s) => s.key.endsWith(':mem'));
  const jobCounts = { 'needs-you': 0, alarm: 0, busy: 0 } as Record<string, number>;
  for (const j of parts.jobs) if (j.state in jobCounts) jobCounts[j.state] += 1;
  const svcBad = parts.services.flatMap((s) => (s.items ?? []).filter((i) => i.state === 'down' || i.state === 'warn'));
  const svcUp = parts.services.reduce((n, s) => n + (s.items ?? []).filter((i) => i.state === 'ok').length, 0);
  const dl = parts.sabQueue;

  if (!snap.signals.length) return null;
  return (
    <section className="deck">
      <div className={`sstrip ${live ? '' : 'stale'}`} title={live ? undefined : 'signals stream down'}>
        {parts.jobs.length + (parts.board ? 1 : 0) > 0 && (
          <Cell id="jobs" state={worst(parts.jobs.length ? parts.jobs : [parts.board!])} open={open === 'jobs'} onOpen={toggle} title={parts.board?.detail}>
            <span className="scell-name">jobs</span>
            {jobCounts['needs-you'] > 0 && <span className="scell-n st-needs-you">✋{jobCounts['needs-you']}</span>}
            {jobCounts.alarm - parts.stale.length > 0 && <span className="scell-n st-alarm">✕{jobCounts.alarm - parts.stale.length}</span>}
            {jobCounts.busy > 0 && <span className="scell-n st-busy">▶{jobCounts.busy}</span>}
            {parts.stale.length > 0 && <span className="scell-sub">{parts.stale.length} stale</span>}
            {!parts.jobs.length && <span className="scell-n sub">—</span>}
          </Cell>
        )}
        {parts.disk.map((d) => {
          const rate = d.rate ?? 0;
          const moving = Math.abs(rate) > 2e6;
          return (
            <Cell key={d.key} id="disk" state={d.state} open={open === 'disk'} onOpen={toggle} title={`${d.title}: ${d.detail ?? ''}`}>
              <span className="scell-name">{shortMount(d.title)}</span>
              {moving && <Spk points={d.history} />}
              <span className={`scell-n ${moving ? (rate > 0 ? 'up' : 'down') : ''}`}>{d.state === 'down' ? '✕' : shortG(d.value)}</span>
              {moving && <span className="scell-sub">{rate > 0 ? '↑' : '↓'}{shortG(Math.abs(rate) * 60)}/m</span>}
            </Cell>
          );
        })}
        {parts.gpu.map((g) => (
          <Cell key={g.key} id="compute" state={g.state} open={open === 'compute'} onOpen={toggle} title={g.detail}>
            <span className="scell-name">{g.title.replace(/^(RTX|GeForce)\s*/i, '')}</span>
            <Spk points={g.history} floor={0} ceil={100} />
            <span className="scell-n">{g.value ?? 0}%</span>
            {g.mem && <span className="scell-sub">{((g.mem.total - g.mem.used) / 1024).toFixed(0)}G free</span>}
          </Cell>
        ))}
        {parts.hosts.map((h) => (
          <Cell key={h.key} id="compute" state={h.state} open={open === 'compute'} onOpen={toggle} title={h.detail}>
            <span className="scell-name">{h.title}</span>
            <span className="scell-n">{h.state === 'down' ? '✕' : h.mem ? `${((h.mem.total - h.mem.used) / 1024).toFixed(0)}G free` : ''}</span>
          </Cell>
        ))}
        {(cpu || mem) && (
          <Cell id="compute" state={worst(parts.sys)} open={open === 'compute'} onOpen={toggle} title={[cpu?.detail, mem?.detail].filter(Boolean).join('\n')}>
            {cpu && <><span className="scell-name">cpu</span><Spk points={cpu.history} floor={0} ceil={100} /><span className="scell-n">{cpu.value ?? '?'}%</span></>}
            {mem && <><span className="scell-name">mem</span><span className="scell-n">{mem.value ?? '?'}%</span></>}
          </Cell>
        )}
        {dl && (
          <Cell id="downloads" state={dl.state} open={open === 'downloads'} onOpen={toggle} title={dl.detail}>
            <span className="scell-name">⬇</span>
            {dl.state === 'busy' ? (
              <><Spk points={dl.history} floor={0} /><span className="scell-n">{shortG(dl.value)}/s</span><span className="scell-sub">{dl.items?.length ?? 0}</span></>
            ) : (
              <span className="scell-n sub">{dl.items?.length ? 'paused' : 'idle'}</span>
            )}
          </Cell>
        )}
        {parts.printers.map((p) => (
          <Cell key={p.key} id="printers" state={p.state} open={open === 'printers'} onOpen={toggle} title={`${p.title}: ${p.detail ?? ''}`}>
            <span className="scell-name">{p.title}</span>
            {p.state === 'busy' ? (
              <><Spk points={p.history} floor={0} ceil={100} /><span className="scell-n">{p.pct ?? 0}%</span>{p.eta != null && <span className="scell-sub">~{fmtDur(p.eta)}</span>}</>
            ) : p.state === 'needs-you' ? (
              <span className="scell-n st-needs-you">✋ {p.pct ?? 0}%</span>
            ) : p.state === 'alarm' || p.state === 'down' ? (
              <span className="scell-n st-alarm">✕</span>
            ) : (
              <span className="scell-n sub">{p.state === 'ok' ? 'done' : 'idle'}</span>
            )}
          </Cell>
        ))}
        {parts.services.length > 0 && (
          <Cell id="services" state={worst(parts.services)} open={open === 'services'} onOpen={toggle} title={parts.services.map((s) => `${s.title}: ${s.detail}`).join('\n')}>
            <span className="scell-name">svc</span>
            <span className="scell-n">{svcUp}</span>
            {svcBad.length > 0 && <span className={`scell-sub st-${worst(parts.services)}`}>{svcBad.length === 1 ? `△ ${svcBad[0].label}` : `△ ${svcBad.length}`}</span>}
          </Cell>
        )}
        {failing.length > 0 && (
          <span className="scell st-down" title={failing.map((f) => `${f.id}: ${f.error}`).join('\n')}>
            <span className="scell-n">✕ {failing.map((f) => f.id).join(' ')}</span>
          </span>
        )}
      </div>

      {parts.rows.length > 0 && (
        <div className="arows">
          {parts.rows.slice(0, 6).map((r) => <AttentionRow key={r.key} row={r} act={act} onOpenSession={onSelect} fresh={fresh.has(r.key)} />)}
          {parts.rows.length > 6 && <div className="sub attn-more">+{parts.rows.length - 6} more</div>}
        </div>
      )}

      {open && (
        <div className="deck-detail">
          {open === 'jobs' && (
            <>
              <JobsTile jobs={parts.jobs.filter((j) => j.source !== 'push' && !inRows.has(j.key))} board={parts.board} pushed={parts.pushed.filter((j) => !inRows.has(j.key))} roster={roster} onSelect={onSelect} act={act} />
              {parts.stale.length > 0 && (
                <div className="arows stale-list">
                  <div className="sub attn-more">stale: failed more than a day ago, nobody waiting</div>
                  {parts.stale.map((r) => <AttentionRow key={r.key} row={r} act={act} onOpenSession={onSelect} />)}
                </div>
              )}
            </>
          )}
          {open === 'disk' && <DiskTile list={parts.disk} />}
          {open === 'compute' && <GpuTile local={parts.gpu} remote={parts.hosts} sys={parts.sys} jobs={parts.jobs} />}
          {open === 'downloads' && <DownloadsTile queue={parts.sabQueue} history={parts.sabHistory} act={act} />}
          {open === 'printers' && <PrintersTile list={parts.printers} act={act} />}
          {open === 'services' && <ServicesTile list={parts.services} />}
        </div>
      )}
    </section>
  );
}

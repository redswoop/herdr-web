import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  TONE_GLYPH,
  attentionRows,
  bySource,
  getPlatform,
  staleRows,
  toneOf,
  type AttentionRow as Row,
  type Roster,
  type Signal,
  type SignalItem,
  type SignalSnapshot,
  type SignalState,
  type SignalTone,
} from '@herdr/shared';
import { alpha, useStyles, useTheme, type Tokens } from '../theme';
import { Sparkline } from './Sparkline';

// The signals deck, phone-sized, same shape as web/src/components/Deck.tsx:
// one wrapping strip of dense cells (name · sparkline · one number), the
// attention rows under it, and one detail section at a time behind a tap.
// Pure view over the signal store (src/signals.tsx).

const fmtBytes = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return '?';
  const a = Math.abs(n);
  if (a >= 1e12) return `${(n / 1e12).toFixed(2)} TB`;
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
  return `${Math.round(n / 1e3)} kB`;
};
const shortG = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return '?';
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e10) return `${Math.round(n / 1e9)}G`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}G`;
  return `${Math.round(n / 1e6)}M`;
};
const fmtDur = (s: number | null | undefined) => {
  if (s == null || !Number.isFinite(s) || s < 0) return '?';
  if (s < 90) return `${Math.round(s)}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  if (s < 172_800) return `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`;
  return `${Math.round(s / 86_400)}d`;
};
const agoShort = (ms: number, now = Date.now()) => {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
};
const shortMount = (t: string) => (t === '/' ? '/' : t.replace(/^\/mnt\//, '').replace(/^\/home\/[^/]+/, '~'));

/** a key without its `@host` suffix (multi-host merges qualify keys) */
const baseKey = (k: string) => k.replace(/@[^@/]*$/, '');
const RANK: Record<SignalState, number> = { 'needs-you': 0, alarm: 1, down: 2, warn: 3, busy: 4, ok: 5, idle: 6 };
const worst = (list: Signal[]): SignalState => list.reduce<SignalState>((w, s) => (RANK[s.state] < RANK[w] ? s.state : w), 'idle');

/** three colours a human has to learn; everything else is plain */
function toneColor(t: Tokens, tone: SignalTone): string {
  switch (tone) {
    case 'needs-you': case 'broken': return t.colors.blocked;
    case 'working': return t.colors.working;
    default: return t.colors.sub;
  }
}
const stateColor = (t: Tokens, s: SignalState | undefined) => toneColor(t, toneOf(s));
const glyph = (s: SignalState | undefined) => { const tone = toneOf(s); return tone ? TONE_GLYPH[tone] : ''; };

type Act = (key: string, action: string) => Promise<unknown>;

// ---------- small parts ----------

function Bar({ pct, state, style }: { pct: number | null | undefined; state?: SignalState; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const p = Math.max(0, Math.min(100, pct ?? 0));
  const color = toneOf(state) ? stateColor(t, state) : t.colors.accent;
  return (
    <View style={[{ height: 3, borderRadius: t.r(2), backgroundColor: t.colors.surface3, overflow: 'hidden' }, style]}>
      <View style={{ width: `${p}%`, height: '100%', backgroundColor: color }} />
    </View>
  );
}

function Pill({ label, onPress, tone, disabled }: { label: string; onPress: () => void; tone?: 'hot' | 'plain'; disabled?: boolean }) {
  const styles = useStyles(makeStyles);
  return (
    <Pressable style={[styles.pill, tone === 'hot' && styles.pillHot, disabled && { opacity: 0.5 }]} onPress={onPress} hitSlop={6} disabled={disabled}>
      <Text style={styles.pillText}>{label}</Text>
    </Pressable>
  );
}

function ItemRows({ items, max = 10 }: { items: SignalItem[]; max?: number }) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={{ gap: 3 }}>
      {items.slice(0, max).map((i) => (
        <View key={i.id} style={styles.item}>
          <Text style={[styles.glyph, { color: stateColor(t, i.state ?? 'ok') }]}>{glyph(i.state)}</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.itemLabel, (i.state === 'down' || i.state === 'alarm') && { color: t.colors.blocked }]} numberOfLines={1} onPress={i.href ? () => Linking.openURL(i.href!) : undefined}>
              {i.label}
            </Text>
            {i.pct != null && <Bar pct={i.pct} state={i.state} style={{ marginTop: 3 }} />}
            {!!i.sub && <Text style={styles.sub} numberOfLines={1}>{i.sub}{i.at ? ` · ${agoShort(i.at)}` : ''}</Text>}
          </View>
        </View>
      ))}
    </View>
  );
}

function Fold({ label, children }: { label: string; children: ReactNode }) {
  const styles = useStyles(makeStyles);
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable onPress={() => setOpen((v) => !v)} hitSlop={6}>
        <Text style={styles.fold}>{open ? '▾' : '▸'} {label}</Text>
      </Pressable>
      {open && <View style={{ marginTop: 4 }}>{children}</View>}
    </View>
  );
}

/** the tail is the point: open scrolled to the end */
function LogTail({ text }: { text: string }) {
  const styles = useStyles(makeStyles);
  const ref = useRef<ScrollView>(null);
  return (
    <ScrollView ref={ref} style={styles.log} nestedScrollEnabled onContentSizeChange={() => ref.current?.scrollToEnd({ animated: false })}>
      <Text style={styles.logText} selectable>{text}</Text>
    </ScrollView>
  );
}

// ---------- new since you last looked ----------

const SEEN_KEY = 'herdr.seen';
function loadSeen(): Record<string, string> {
  try { return JSON.parse(getPlatform().kv.get(SEEN_KEY) || '{}') as Record<string, string>; } catch { return {}; }
}
/** ids whose version this viewer has not had on screen for a few seconds yet */
export function useSeen(items: { id: string; version: string }[], dwellMs = 4000): Set<string> {
  const seen = useRef<Record<string, string> | null>(null);
  if (seen.current == null) seen.current = loadSeen();
  const fresh = useMemo(() => new Set(items.filter((i) => seen.current![i.id] !== i.version).map((i) => i.id)), [items]);
  const [, bump] = useState(0);
  useEffect(() => {
    if (!fresh.size) return;
    const timer = setTimeout(() => {
      for (const i of items) seen.current![i.id] = i.version;
      try { getPlatform().kv.set(SEEN_KEY, JSON.stringify(seen.current)); } catch {}
      bump((n) => n + 1);
    }, dwellMs);
    return () => clearTimeout(timer);
  }, [fresh, items, dwellMs]);
  return fresh;
}

// ---------- the attention row ----------

/** One row per thing that wants you: what, from where, when, what it means,
 *  then the verbs. Tapping the body expands in place; only the labeled
 *  "open" pill navigates. */
export function AttentionRow({ row, act, onOpenSession, compact, fresh }: { row: Row; act: Act; onOpenSession?: (paneId: string) => void; compact?: boolean; fresh?: boolean }) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const s = row.sig;
  const c = toneColor(t, row.tone);

  const fetchLog = async () => {
    setBusy('log');
    try { setLog(String(((await act(row.key, 'log')) as { text?: string })?.text ?? '').trimEnd() || '(empty log)'); } catch (e) { setErr(String((e as Error).message ?? e)); } finally { setBusy(null); }
  };
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && log == null && row.actions.includes('log')) void fetchLog();
  };
  const go = (a: string) => {
    const run = async () => {
      setBusy(a); setErr(null);
      try { await act(row.key, a); setPending(a === 'retry' ? 're-running' : a === 'ack' ? 'cleared' : a); } catch (e) { setErr(String((e as Error).message ?? e)); } finally { setBusy(null); }
    };
    if (a === 'cancel') Alert.alert(`cancel "${row.title}"?`, row.help.cancel ?? '', [{ text: 'keep', style: 'cancel' }, { text: 'cancel it', style: 'destructive', onPress: run }]);
    else void run();
  };

  const when = row.at ? agoShort(row.at) : null;
  const where = row.from.label ? (compact ? null : `from ${row.from.label}`) : row.from.where ? `from a finished session in ${row.from.where}` : null;
  const since = row.commitsSince ? `${row.commitsSince} commit${row.commitsSince === 1 ? '' : 's'} since` : null;
  const meaning = row.meaning ?? s.detail ?? '';
  const verbs = row.actions.filter((a) => a !== 'log');
  const facts = [s.sub, s.host, s.startedAt ? `started ${agoShort(s.startedAt)}` : null, s.runMs != null ? `ran ${fmtDur(s.runMs / 1000)}` : null, s.detail && s.detail !== meaning ? s.detail : null].filter(Boolean).join(' · ');

  return (
    <View style={[styles.arow, { borderLeftColor: row.stale ? t.colors.hairline : c }, row.stale && { opacity: 0.6 }]}>
      <Pressable style={styles.arowBody} onPress={toggle} onLongPress={() => row.help[verbs[0]] && Alert.alert(verbs.map((v) => `${v}: ${row.help[v] ?? ''}`).join('\n'))}>
        <Text style={[styles.glyph, { color: c, marginTop: 2 }]}>{TONE_GLYPH[row.tone]}</Text>
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <View style={styles.row}>
            {fresh && <View style={[t.dot(6), { backgroundColor: t.colors.accent }]} />}
            <Text style={styles.arowTitle} numberOfLines={open ? undefined : 2}>{row.title}</Text>
          </View>
          {(where || when || since || row.stale) && (
            <Text style={styles.sub} numberOfLines={1}>{[where, when, since, row.stale ? 'stale' : null].filter(Boolean).join(' · ')}</Text>
          )}
          {!!meaning && <Text style={styles.arowMeaning} numberOfLines={open ? undefined : 3}>{meaning}</Text>}
        </View>
      </Pressable>
      {(verbs.length > 0 || pending || (!compact && row.from.live && row.from.paneId && onOpenSession)) && (
        <View style={styles.pills}>
          {pending && <Text style={styles.sub}>{pending}</Text>}
          {!compact && row.from.live && row.from.paneId && onOpenSession && (
            <Pill label={`open · ${row.from.label}`} tone="hot" onPress={() => onOpenSession(row.from.paneId!)} />
          )}
          {verbs.map((a) => <Pill key={a} label={busy === a ? '…' : a} disabled={busy != null || pending != null} onPress={() => go(a)} />)}
          {!!err && <Text style={[styles.sub, { color: t.colors.blocked }]}>{err}</Text>}
        </View>
      )}
      {open && (
        <View style={{ gap: 4 }}>
          {!!facts && <Text style={styles.sub}>{facts}</Text>}
          {row.actions.includes('log') && (log == null ? <Text style={styles.sub}>loading log…</Text> : <LogTail text={log} />)}
        </View>
      )}
    </View>
  );
}

/** the rows a chat owns, under its header; nothing on a quiet session */
export function ChatRows({ snap, roster, paneId, act }: { snap: SignalSnapshot; roster: Roster; paneId: string; act: Act }) {
  const styles = useStyles(makeStyles);
  const rows = useMemo(() => attentionRows(snap, roster, { paneId }), [snap, roster, paneId]);
  if (!rows.length) return null;
  return (
    <View style={styles.chatRows}>
      {rows.slice(0, 3).map((r) => <AttentionRow key={r.key} row={r} act={act} compact />)}
    </View>
  );
}

// ---------- the strip ----------

type Section = 'jobs' | 'disk' | 'compute' | 'downloads' | 'printers' | 'services';
const OPEN_KEY = 'herdr.deckOpen';
const SECTIONS: Section[] = ['jobs', 'disk', 'compute', 'downloads', 'printers', 'services'];
const loadOpen = (): Section | null => {
  const v = getPlatform().kv.get(OPEN_KEY);
  return v && (SECTIONS as string[]).includes(v) ? (v as Section) : null;
};

function Cell({ state, open, onPress, children }: { state: SignalState; open: boolean; onPress: () => void; children: ReactNode }) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const tone = toneOf(state);
  return (
    <Pressable style={[styles.cell, open && styles.cellOpen, tone && { borderColor: alpha(toneColor(t, tone), 0.5) }, !tone && !open && { opacity: 0.7 }]} onPress={onPress} hitSlop={4}>
      {children}
    </Pressable>
  );
}

function Spk({ points, color, floor, ceil }: { points?: [number, number][]; color: string; floor?: number; ceil?: number }) {
  if (!points || points.length < 2) return null;
  return <Sparkline points={points} color={color} floor={floor} ceil={ceil} height={12} width={26} />;
}

// ---------- detail sections: the answer first, then evidence ----------

function Answer({ text }: { text: string }) {
  const styles = useStyles(makeStyles);
  return <Text style={styles.answer}>{text}</Text>;
}

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

function JobRow({ s, act }: { s: Signal; act: Act }) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const n = s.done != null && s.total ? `${Math.round(s.done)}/${Math.round(s.total)}${s.unit ? ` ${s.unit}` : ''}` : s.pct != null ? `${s.pct}%` : '';
  const verbs = (s.actions ?? []).filter((a) => a !== 'log');
  return (
    <View style={styles.job}>
      <View style={styles.row}>
        <Text style={[styles.glyph, { color: stateColor(t, s.state) }]}>{glyph(s.state)}</Text>
        <Text style={styles.jobTitle} numberOfLines={1}>{s.title}</Text>
        <Text style={styles.sub} numberOfLines={1}>{s.sub}{s.host ? ` · ${s.host}` : ''}</Text>
      </View>
      {s.state === 'busy' && (s.pct != null || s.done != null) && <Bar pct={s.pct} state={s.state} />}
      <Text style={styles.sub} numberOfLines={2}>
        {n}{n && s.detail ? ' · ' : ''}{s.detail}
        {s.eta != null && s.state === 'busy' ? ` · ~${fmtDur(s.eta)}` : ''}
        {s.state !== 'busy' && s.finishedAt ? `${s.runMs != null ? ` · ran ${fmtDur(s.runMs / 1000)}` : ''} · ${agoShort(s.finishedAt)}` : ''}
      </Text>
      {verbs.length > 0 && (
        <View style={styles.pills}>
          {verbs.map((a) => <Pill key={a} label={a} onPress={() => (a === 'cancel' ? Alert.alert('cancel job?', s.title, [{ text: 'keep', style: 'cancel' }, { text: 'cancel it', style: 'destructive', onPress: () => void act(s.key, a) }]) : void act(s.key, a))} />)}
        </View>
      )}
    </View>
  );
}

function PrinterRow({ s, act }: { s: Signal; act: Act }) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const tp = s.temps;
  const trays = (s.items ?? []).filter((i) => i.id.startsWith('ams:') || i.id === 'ext');
  const hms = (s.items ?? []).filter((i) => i.id.startsWith('hms:'));
  const fatal = hms.filter((i) => i.state === 'alarm');
  const temps = [
    tp && tp.nozzle != null ? `nozzle ${Math.round(tp.nozzle)}°${tp.nozzleTarget ? `/${Math.round(tp.nozzleTarget)}` : ''}` : null,
    tp && tp.bed != null ? `bed ${Math.round(tp.bed)}°${tp.bedTarget ? `/${Math.round(tp.bedTarget)}` : ''}` : null,
    tp && tp.chamber != null && tp.chamber > 5 ? `chamber ${Math.round(tp.chamber)}°` : null,
  ].filter(Boolean).join(' · ');
  return (
    <View style={styles.job}>
      <View style={styles.row}>
        <Text style={[styles.glyph, { color: stateColor(t, s.state) }]}>{glyph(s.state)}</Text>
        <Text style={styles.jobTitle} numberOfLines={1}>{s.title}</Text>
        <Text style={[styles.sub, { flex: 1 }]} numberOfLines={1}>{s.sub ?? ''}</Text>
      </View>
      {(s.state === 'busy' || s.state === 'needs-you') && s.pct != null && <Bar pct={s.pct} state={s.state} />}
      <Text style={styles.sub} numberOfLines={2}>
        {s.pct != null && s.state !== 'idle' ? `${s.pct}% · ` : ''}{s.detail}{s.eta != null && s.state === 'busy' ? ` · ~${fmtDur(s.eta)}` : ''}
      </Text>
      {!!temps && <Text style={styles.sub} numberOfLines={1}>{temps}</Text>}
      {!!s.actions?.length && (
        <View style={styles.pills}>
          {s.actions.map((a) => <Pill key={a} label={a} tone={a === 'resume' ? 'hot' : 'plain'} onPress={() => act(s.key, a)} />)}
        </View>
      )}
      {fatal.length > 0 && <ItemRows items={fatal} />}
      {hms.length > fatal.length && <Fold label={`${hms.length} HMS`}><ItemRows items={hms.filter((i) => i.state !== 'alarm')} max={20} /></Fold>}
      {trays.length > 0 && (
        <Fold label={s.feeding ? `feeding ${s.feeding.type ?? '?'}${s.feeding.remain != null && s.feeding.remain >= 0 ? ` · ${s.feeding.remain}% left` : ''}` : `${trays.length} trays`}>
          <ItemRows items={trays} max={20} />
        </Fold>
      )}
    </View>
  );
}

// ---------- the deck ----------

export function Deck({ snap, live, roster, onSelect, act }: { snap: SignalSnapshot; live: boolean; roster: Roster; onSelect: (paneId: string) => void; act: Act }) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const [open, setOpen] = useState<Section | null>(loadOpen);
  const toggle = (s: Section) => setOpen((cur) => {
    const next = cur === s ? null : s;
    getPlatform().kv.set(OPEN_KEY, next ?? '');
    return next;
  });
  const p = useMemo(() => {
    const gaffer = bySource(snap, 'gaffer');
    return {
      disk: bySource(snap, 'disk'),
      gpu: bySource(snap, 'gpu'),
      sys: bySource(snap, 'sys'),
      hosts: gaffer.filter((s) => s.key.startsWith('gaffer:host:') && !s.self),
      jobs: [...gaffer.filter((s) => s.kind === 'job'), ...bySource(snap, 'push')],
      board: gaffer.find((s) => baseKey(s.key) === 'gaffer:board'),
      sabQ: snap.signals.find((s) => baseKey(s.key) === 'sab:queue'),
      sabH: snap.signals.find((s) => baseKey(s.key) === 'sab:history'),
      printers: bySource(snap, 'bambu'),
      services: bySource(snap, 'services'),
      rows: attentionRows(snap, roster),
      stale: staleRows(snap, roster),
    };
  }, [snap, roster]);
  const fresh = useSeen(useMemo(() => p.rows.map((r) => ({ id: r.key, version: String(r.at ?? 0) })), [p.rows]));
  if (!snap.updatedAt && !live) return null;
  if (!snap.signals.length) return null;

  const inRows = new Set([...p.rows, ...p.stale].map((r) => r.key));
  const jobCounts = { needs: 0, alarm: 0, busy: 0 };
  for (const j of p.jobs) {
    if (j.state === 'needs-you') jobCounts.needs++;
    else if (j.state === 'alarm' || j.state === 'down') jobCounts.alarm++;
    else if (j.state === 'busy') jobCounts.busy++;
  }
  const cpu = p.sys.find((s) => baseKey(s.key) === 'sys:cpu');
  const mem = p.sys.find((s) => baseKey(s.key) === 'sys:mem');
  const svcBad = p.services.flatMap((s) => (s.items ?? []).filter((i) => i.state === 'down' || i.state === 'warn'));
  const svcUp = p.services.reduce((n, s) => n + (s.items ?? []).filter((i) => i.state === 'ok').length, 0);
  const failing = snap.sources.filter((s) => s.ok === false);
  const dl = p.sabQ;
  const workingC = t.colors.working;

  return (
    <View style={styles.deck}>
      <View style={styles.strip}>
        {(p.jobs.length > 0 || p.board) && (
          <Cell state={worst(p.jobs.length ? p.jobs : p.board ? [p.board] : [])} open={open === 'jobs'} onPress={() => toggle('jobs')}>
            <Text style={styles.cellName}>jobs</Text>
            {jobCounts.needs > 0 && <Text style={[styles.cellN, { color: t.colors.blocked }]}>✋{jobCounts.needs}</Text>}
            {jobCounts.alarm - p.stale.length > 0 && <Text style={[styles.cellN, { color: t.colors.blocked }]}>✕{jobCounts.alarm - p.stale.length}</Text>}
            {jobCounts.busy > 0 && <Text style={[styles.cellN, { color: workingC }]}>▶{jobCounts.busy}</Text>}
            {p.stale.length > 0 && <Text style={styles.cellSub}>{p.stale.length} stale</Text>}
            {!p.jobs.length && <Text style={[styles.cellN, { color: t.colors.sub }]}>—</Text>}
          </Cell>
        )}
        {p.disk.map((d) => {
          const rate = d.rate ?? 0;
          const moving = Math.abs(rate) > 2e6;
          const c = rate > 0 ? t.colors.done : t.colors.blocked;
          return (
            <Cell key={d.key} state={d.state} open={open === 'disk'} onPress={() => toggle('disk')}>
              <Text style={styles.cellName}>{shortMount(d.title)}</Text>
              {moving && <Spk points={d.history} color={c} />}
              <Text style={[styles.cellN, moving && { color: c }]}>{d.state === 'down' ? '✕' : shortG(d.value)}</Text>
              {moving && <Text style={styles.cellSub}>{rate > 0 ? '↑' : '↓'}{shortG(Math.abs(rate) * 60)}/m</Text>}
            </Cell>
          );
        })}
        {p.gpu.map((g) => (
          <Cell key={g.key} state={g.state} open={open === 'compute'} onPress={() => toggle('compute')}>
            <Text style={styles.cellName}>{g.title.replace(/^(RTX|GeForce)\s*/i, '')}</Text>
            <Spk points={g.history} color={workingC} floor={0} ceil={100} />
            <Text style={styles.cellN}>{g.value ?? 0}%</Text>
            {!!g.mem && <Text style={styles.cellSub}>{((g.mem.total - g.mem.used) / 1024).toFixed(0)}G free</Text>}
          </Cell>
        ))}
        {p.hosts.map((h) => (
          <Cell key={h.key} state={h.state} open={open === 'compute'} onPress={() => toggle('compute')}>
            <Text style={styles.cellName}>{h.title}</Text>
            <Text style={styles.cellN}>{h.state === 'down' ? '✕' : h.mem ? `${((h.mem.total - h.mem.used) / 1024).toFixed(0)}G free` : ''}</Text>
          </Cell>
        ))}
        {(cpu || mem) && (
          <Cell state={worst(p.sys)} open={open === 'compute'} onPress={() => toggle('compute')}>
            {cpu && <><Text style={styles.cellName}>cpu</Text><Spk points={cpu.history} color={workingC} floor={0} ceil={100} /><Text style={styles.cellN}>{cpu.value ?? '?'}%</Text></>}
            {mem && <><Text style={styles.cellName}>mem</Text><Text style={styles.cellN}>{mem.value ?? '?'}%</Text></>}
          </Cell>
        )}
        {dl && (
          <Cell state={dl.state} open={open === 'downloads'} onPress={() => toggle('downloads')}>
            <Text style={styles.cellName}>⬇</Text>
            {dl.state === 'busy' ? (
              <><Spk points={dl.history} color={workingC} floor={0} /><Text style={styles.cellN}>{shortG(dl.value)}/s</Text><Text style={styles.cellSub}>{dl.items?.length ?? 0}</Text></>
            ) : (
              <Text style={[styles.cellN, { color: t.colors.sub }]}>{dl.items?.length ? 'paused' : 'idle'}</Text>
            )}
          </Cell>
        )}
        {p.printers.map((pr) => (
          <Cell key={pr.key} state={pr.state} open={open === 'printers'} onPress={() => toggle('printers')}>
            <Text style={styles.cellName}>{pr.title}</Text>
            {pr.state === 'busy' ? (
              <><Spk points={pr.history} color={workingC} floor={0} ceil={100} /><Text style={styles.cellN}>{pr.pct ?? 0}%</Text>{pr.eta != null && <Text style={styles.cellSub}>~{fmtDur(pr.eta)}</Text>}</>
            ) : pr.state === 'needs-you' ? (
              <Text style={[styles.cellN, { color: t.colors.blocked }]}>✋ {pr.pct ?? 0}%</Text>
            ) : pr.state === 'alarm' || pr.state === 'down' ? (
              <Text style={[styles.cellN, { color: t.colors.blocked }]}>✕</Text>
            ) : (
              <Text style={[styles.cellN, { color: t.colors.sub }]}>{pr.state === 'ok' ? 'done' : 'idle'}</Text>
            )}
          </Cell>
        ))}
        {p.services.length > 0 && (
          <Cell state={worst(p.services)} open={open === 'services'} onPress={() => toggle('services')}>
            <Text style={styles.cellName}>svc</Text>
            <Text style={styles.cellN}>{svcUp}</Text>
            {svcBad.length > 0 && <Text style={styles.cellSub}>△ {svcBad.length === 1 ? svcBad[0].label : svcBad.length}</Text>}
          </Cell>
        )}
        {failing.length > 0 && (
          <View style={[styles.cell, { borderColor: alpha(t.colors.blocked, 0.5) }]}>
            <Text style={[styles.cellN, { color: t.colors.blocked }]}>✕ {failing.map((f) => f.id).join(' ')}</Text>
          </View>
        )}
      </View>

      {p.rows.length > 0 && (
        <View style={styles.rows}>
          {p.rows.slice(0, 6).map((r) => <AttentionRow key={r.key} row={r} act={act} onOpenSession={onSelect} fresh={fresh.has(r.key)} />)}
          {p.rows.length > 6 && <Text style={styles.sub}>+{p.rows.length - 6} more</Text>}
        </View>
      )}

      {open && (
        <View style={styles.detail}>
          <Pressable onPress={() => toggle(open)} hitSlop={6}><Text style={styles.detailTitle}>{open} ▴</Text></Pressable>
          {open === 'jobs' && (
            <>
              {p.jobs.filter((j) => !inRows.has(j.key)).map((s) => <JobRow key={s.key} s={s} act={act} />)}
              {!p.jobs.filter((j) => !inRows.has(j.key)).length && <Text style={styles.sub}>nothing else running</Text>}
              {p.stale.length > 0 && (
                <Fold label={`${p.stale.length} stale failure${p.stale.length === 1 ? '' : 's'}`}>
                  <View style={{ gap: 6 }}>{p.stale.map((r) => <AttentionRow key={r.key} row={r} act={act} onOpenSession={onSelect} />)}</View>
                </Fold>
              )}
              {!!p.board?.items?.length && <Fold label={`${p.board.items.length} finished lately`}><ItemRows items={p.board.items} /></Fold>}
            </>
          )}
          {open === 'disk' && (
            <>
              <Answer text={diskAnswer(p.disk)} />
              {p.disk.map((s) => {
                const rate = s.rate ?? 0;
                const moving = Math.abs(rate) > 2e6;
                const c = rate > 0 ? t.colors.done : t.colors.blocked;
                return (
                  <View key={s.key} style={styles.block}>
                    <View style={styles.row}>
                      <Text style={styles.mono} numberOfLines={1}>{s.title}</Text>
                      <Text style={[styles.big, moving && { color: c }]}>{s.state === 'down' ? 'unreachable' : `${fmtBytes(s.value)} free`}</Text>
                      <Text style={styles.sub}>{s.total ? `of ${fmtBytes(s.total)}` : ''}</Text>
                    </View>
                    <Bar pct={s.pct} state={s.state} />
                    {moving && !!s.history && s.history.length > 2 && <Sparkline points={s.history} color={c} height={20} />}
                  </View>
                );
              })}
            </>
          )}
          {open === 'compute' && (
            <>
              <Answer text={gpuAnswer(p.gpu, p.jobs)} />
              {p.gpu.map((g) => (
                <View key={g.key} style={styles.block}>
                  <View style={styles.row}>
                    <Text style={styles.strong}>{g.title}</Text>
                    <Text style={styles.big}>{g.value ?? 0}%</Text>
                    <Text style={styles.sub} numberOfLines={1}>{g.mem ? `${(g.mem.used / 1024).toFixed(1)} / ${(g.mem.total / 1024).toFixed(0)} GB` : ''}{g.temp != null ? ` · ${g.temp}°` : ''}{g.power != null ? ` · ${g.power} W` : ''}</Text>
                  </View>
                  <Bar pct={g.mem ? (g.mem.used / g.mem.total) * 100 : g.pct} state={g.state} />
                  {!!g.history && <Sparkline points={g.history} color={workingC} floor={0} ceil={100} height={20} />}
                  {!!g.items?.length && <Text style={styles.sub} numberOfLines={1}>{g.items.slice(0, 3).map((i) => `${i.label} ${i.sub?.replace(' MiB', 'M') ?? ''}`).join(' · ')}</Text>}
                </View>
              ))}
              {p.hosts.map((h) => (
                <View key={h.key} style={styles.block}>
                  <View style={styles.row}>
                    <Text style={styles.strong}>{h.title}</Text>
                    <Text style={styles.big}>{h.state === 'down' ? 'offline' : h.mem ? `${(h.mem.used / 1024).toFixed(1)} / ${(h.mem.total / 1024).toFixed(0)} GB` : ''}</Text>
                    <Text style={styles.sub} numberOfLines={1}>{h.state === 'down' ? h.detail : h.items?.slice(0, 2).map((i) => i.label).join(' · ')}</Text>
                  </View>
                  {h.state !== 'down' && <Bar pct={h.pct} state={h.state} />}
                </View>
              ))}
              {p.sys.length > 0 && (
                <View style={[styles.row, { gap: 12 }]}>
                  {p.sys.map((s) => (
                    <View key={s.key} style={{ flex: 1 }}>
                      <View style={styles.row}>
                        <Text style={styles.hud}>{s.title}</Text>
                        <Text style={styles.big}>{s.value ?? '?'}%</Text>
                      </View>
                      {!!s.history && <Sparkline points={s.history} color={workingC} floor={0} ceil={100} height={16} />}
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
          {open === 'downloads' && dl && (
            <>
              <View style={styles.row}>
                <Text style={[styles.big, dl.state === 'busy' && { color: workingC }]}>{dl.state === 'busy' ? `${fmtBytes(dl.value)}/s` : dl.items?.length ? 'paused' : 'idle'}</Text>
                <Text style={[styles.sub, { flex: 1 }]} numberOfLines={1}>{dl.detail}</Text>
                {dl.actions?.map((a) => <Pill key={a} label={a} onPress={() => act(dl.key, a)} />)}
              </View>
              {dl.state === 'busy' && !!dl.history && <Sparkline points={dl.history} color={workingC} floor={0} height={20} />}
              {!!dl.items?.length && <ItemRows items={dl.items} />}
              {!!p.sabH?.items?.length && <Fold label={p.sabH.detail ?? 'history'}><ItemRows items={p.sabH.items} max={6} /></Fold>}
            </>
          )}
          {open === 'printers' && p.printers.map((s) => <PrinterRow key={s.key} s={s} act={act} />)}
          {open === 'services' && (
            <>
              <Answer text={svcBad.length ? `${svcBad.map((i) => `${i.label}${i.state === 'down' ? ' down' : i.sub ? ` ${i.sub}` : ''}`).join(' · ')} · ${svcUp} up` : `all ${svcUp} up`} />
              {p.services.map((s) => {
                const bad = (s.items ?? []).filter((i) => i.state === 'down' || i.state === 'warn');
                return (
                  <View key={s.key} style={{ gap: 4 }}>
                    {bad.length > 0 && <ItemRows items={bad} />}
                    <Fold label={`${s.title}: ${s.detail ?? ''}`}><ItemRows items={(s.items ?? []).filter((i) => !bad.includes(i))} max={40} /></Fold>
                  </View>
                );
              })}
            </>
          )}
        </View>
      )}
    </View>
  );
}

// ---------- per-card lines ----------

/** Two lines per project card: what is going on across its sessions, and
 *  what you do next. */
export function Recap({ sig, fresh }: { sig: Signal | undefined; fresh?: boolean }) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const r = sig?.recap;
  if (!r?.now) return null;
  return (
    <View style={styles.recap}>
      <View style={styles.row}>
        {fresh && <View style={[t.dot(6), { backgroundColor: t.colors.accent, marginTop: 4 }]} />}
        <Text style={styles.recapNow} numberOfLines={3}>{r.now}</Text>
      </View>
      {!!r.next && <Text style={styles.sub} numberOfLines={2}>{r.next}</Text>}
    </View>
  );
}

/** The one per-row line that earns its pixels: the question a blocked
 *  session is waiting on. */
export function Question({ beat }: { beat: Signal | undefined }) {
  const styles = useStyles(makeStyles);
  const q = beat?.recap?.next || beat?.said;
  if (!q) return null;
  return <Text style={styles.question} numberOfLines={2}>{q}</Text>;
}

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
    deck: { gap: 8, marginBottom: 4 },
    strip: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
    cell: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 6,
      paddingVertical: 3,
      borderRadius: t.r(4),
      borderWidth: 1,
      borderColor: t.colors.hairline,
      backgroundColor: t.cyber ? alpha(t.colors.surface, 0.7) : t.colors.surface,
    },
    cellOpen: { borderColor: alpha(t.colors.accent, 0.6), opacity: 1 },
    cellName: { ...t.font('mono'), color: t.colors.sub, fontSize: t.sz('ui', 10) },
    cellN: { ...t.font('mono', '700'), color: t.colors.text, fontSize: t.sz('ui', 11), fontVariant: ['tabular-nums'] },
    cellSub: { ...t.font('mono'), color: t.colors.sub, fontSize: t.sz('ui', 10) },
    rows: { gap: 6 },
    chatRows: { gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.hairline },
    arow: {
      gap: 5,
      paddingVertical: 6,
      paddingLeft: 8,
      paddingRight: 8,
      borderLeftWidth: 2,
      borderRadius: t.r(4),
      backgroundColor: t.cyber ? alpha(t.colors.surface, 0.8) : t.colors.surface,
    },
    arowBody: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
    arowTitle: { ...t.font('ui', '600'), color: t.colors.text, fontSize: t.sz('ui', 13), flexShrink: 1 },
    arowMeaning: { ...t.font('ui'), color: t.colors.text, fontSize: t.sz('ui', 12) },
    detail: {
      gap: 6,
      padding: 10,
      borderRadius: t.radius.md,
      borderWidth: t.cyber ? 0 : 1,
      borderColor: t.colors.hairline,
      backgroundColor: t.cyber ? alpha(t.colors.surface, 0.9) : t.colors.surface,
    },
    detailTitle: { color: t.cyber ? t.colors.red : t.colors.text, fontSize: t.sz('ui', 11), ...t.font(t.cyber ? 'display' : 'ui', '700'), letterSpacing: 1.5, textTransform: 'uppercase' },
    answer: { ...t.font('ui', '600'), color: t.colors.text, fontSize: t.sz('ui', 13) },
    glyph: { fontSize: t.sz('ui', 11), width: 14, textAlign: 'center' },
    row: { flexDirection: 'row', alignItems: 'baseline', gap: 6, minWidth: 0 },
    block: { gap: 3, paddingVertical: 3 },
    mono: { flex: 1, ...t.font('mono'), color: t.colors.text, fontSize: t.sz('ui', 12) },
    strong: { ...t.font('ui', '700'), color: t.colors.text, fontSize: t.sz('ui', 12) },
    big: { ...t.font('ui', '700'), color: t.colors.text, fontSize: t.sz('ui', 13), fontVariant: ['tabular-nums'] },
    hud: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.sub, fontSize: t.sz('ui', 10), textTransform: 'uppercase', letterSpacing: 1, flex: 1 },
    sub: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.sub, fontSize: t.sz('ui', 11), flexShrink: 1 },
    fold: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.sub, fontSize: t.sz('ui', 11), paddingVertical: 2 },
    item: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
    itemLabel: { ...t.font('ui'), color: t.colors.text, fontSize: t.sz('ui', 12) },
    job: { gap: 4, paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.hairline },
    jobTitle: { flex: 1, ...t.font('ui', '600'), color: t.colors.text, fontSize: t.sz('ui', 12.5) },
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
    pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: t.r(999), borderWidth: 1, borderColor: t.colors.hairline, backgroundColor: t.colors.surface2 },
    pillHot: { borderColor: alpha(t.colors.accent, 0.5) },
    pillText: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.text, fontSize: t.sz('ui', 11) },
    log: { maxHeight: 180, borderRadius: t.r(4), backgroundColor: t.colors.surface2, padding: 6 },
    logText: { ...t.font('mono'), color: t.colors.text, fontSize: t.sz('ui', 10) },
    recap: { gap: 1, paddingBottom: 6 },
    recapNow: { ...t.font('ui'), color: t.colors.text, fontSize: t.sz('ui', 12), flexShrink: 1 },
    question: { ...t.font('ui', '600'), color: t.colors.blocked, fontSize: t.sz('ui', 12), paddingLeft: 18, paddingBottom: 6 },
  });

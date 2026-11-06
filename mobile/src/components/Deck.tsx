import { useMemo, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { bySource, getPlatform, type Agent, type Roster, type Signal, type SignalItem, type SignalSnapshot, type SignalState } from '@herdr/shared';
import { alpha, useStyles, useTheme, type Tokens } from '../theme';
import { Sparkline } from './Sparkline';

// The signals deck, phone-sized: the same tiles as web/src/components/Deck.tsx
// stacked in one column. Pure view over the signal store (src/signals.tsx).

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
const agoShort = (ms: number, now = Date.now()) => {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
};

/** a key without its `@host` suffix (multi-host merges qualify keys) */
const baseKey = (k: string) => k.replace(/@[^@/]*$/, '');
const RANK: Record<SignalState, number> = { 'needs-you': 0, alarm: 1, down: 2, warn: 3, busy: 4, ok: 5, idle: 6 };
const worst = (list: Signal[]): SignalState => list.reduce<SignalState>((w, s) => (RANK[s.state] < RANK[w] ? s.state : w), 'idle');
const GLYPH: Record<SignalState, string> = { 'needs-you': '✋', alarm: '⚠', down: '✕', warn: '△', busy: '▶', ok: '●', idle: '○' };

function stateColor(t: Tokens, s: SignalState | undefined): string {
  switch (s) {
    case 'needs-you': case 'alarm': case 'down': return t.colors.blocked;
    case 'warn': return t.colors.working;
    case 'busy': return t.colors.working;
    case 'ok': return t.colors.done;
    default: return t.colors.idle;
  }
}

function Bar({ pct, state, style }: { pct: number | null | undefined; state?: SignalState; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const p = Math.max(0, Math.min(100, pct ?? 0));
  const color = state === 'ok' || !state ? t.colors.accent : stateColor(t, state);
  return (
    <View style={[{ height: 4, borderRadius: t.r(2), backgroundColor: t.colors.surface3, overflow: 'hidden' }, style]}>
      <View style={{ width: `${p}%`, height: '100%', backgroundColor: color }} />
    </View>
  );
}

function Tile({ title, state, right, children }: { title: string; state: SignalState; right?: string; children: React.ReactNode }) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const c = stateColor(t, state);
  return (
    <View style={[styles.tile, { borderLeftColor: c }]}>
      <View style={styles.tileHead}>
        <Text style={[styles.glyph, { color: c }]}>{GLYPH[state]}</Text>
        <Text style={styles.tileTitle}>{title}</Text>
        {!!right && <Text style={styles.tileRight} numberOfLines={1}>{right}</Text>}
      </View>
      {children}
    </View>
  );
}

function Pill({ label, onPress, tone }: { label: string; onPress: () => void; tone?: 'hot' | 'plain' }) {
  const styles = useStyles(makeStyles);
  return (
    <Pressable style={[styles.pill, tone === 'hot' && styles.pillHot]} onPress={onPress} hitSlop={6}>
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
          <Text style={[styles.glyph, { color: stateColor(t, i.state ?? 'ok') }]}>{GLYPH[i.state ?? 'ok']}</Text>
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

function Fold({ label, children }: { label: string; children: React.ReactNode }) {
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

function sessionFor(sig: Signal, roster: Roster): Agent | undefined {
  const a = sig.attach;
  if (!a) return undefined;
  if (a.paneId) return roster.agents.find((x) => x.paneId === a.paneId);
  if (a.cwd) {
    const cwd = a.cwd.replace(/\/$/, '');
    return roster.agents.find((x) => (x.cwd ?? '').replace(/\/$/, '') === cwd) ?? roster.agents.find((x) => x.repoRoot && cwd.startsWith(x.repoRoot));
  }
  return undefined;
}

type Act = (key: string, action: string) => Promise<unknown>;

function JobRow({ s, roster, onSelect, act }: { s: Signal; roster: Roster; onSelect: (p: string) => void; act: Act }) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const [busy, setBusy] = useState<string | null>(null);
  const go = (a: string) => {
    const run = async () => {
      setBusy(a);
      try { await act(s.key, a); } catch (e) { Alert.alert(`${a} failed`, String((e as Error).message ?? e)); } finally { setBusy(null); }
    };
    if (a === 'cancel') Alert.alert('cancel job?', s.title, [{ text: 'keep', style: 'cancel' }, { text: 'cancel it', style: 'destructive', onPress: run }]);
    else void run();
  };
  const sess = sessionFor(s, roster);
  const n = s.done != null && s.total ? `${Math.round(s.done)}/${Math.round(s.total)}${s.unit ? ` ${s.unit}` : ''}` : s.pct != null ? `${s.pct}%` : '';
  return (
    <View style={styles.job}>
      <View style={styles.row}>
        <Text style={[styles.glyph, { color: stateColor(t, s.state) }]}>{GLYPH[s.state]}</Text>
        <Text style={styles.jobTitle} numberOfLines={1}>{s.title}</Text>
        <Text style={styles.sub} numberOfLines={1}>{s.sub}{s.host ? ` · ${s.host}` : ''}</Text>
      </View>
      {(s.pct != null || s.done != null) && <Bar pct={s.pct} state={s.state} />}
      <Text style={styles.sub} numberOfLines={2}>
        {n}{n && s.detail ? ' · ' : ''}{s.detail}{s.eta != null && s.state === 'busy' ? ` · ~${fmtDur(s.eta)}` : ''}
      </Text>
      {(!!s.actions?.length || sess) && (
        <View style={styles.pills}>
          {sess && <Pill label={`↗ ${sess.label ?? sess.sessionTitle ?? sess.paneId}`} onPress={() => onSelect(sess.paneId)} tone="hot" />}
          {s.actions?.map((a) => <Pill key={a} label={busy === a ? '…' : a} onPress={() => go(a)} />)}
        </View>
      )}
    </View>
  );
}

export function Deck({ snap, live, roster, onSelect, act }: { snap: SignalSnapshot; live: boolean; roster: Roster; onSelect: (paneId: string) => void; act: Act }) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const [open, setOpen] = useState<boolean>(() => getPlatform().kv.get(DECK_KEY) !== 'closed');
  const toggle = () => {
    setOpen((v) => {
      getPlatform().kv.set(DECK_KEY, v ? 'closed' : 'open');
      return !v;
    });
  };
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
    };
  }, [snap]);
  const attention = snap.signals.filter((s) => s.source !== 'herd' && (s.state === 'needs-you' || s.state === 'alarm' || s.state === 'down')).length;
  const running = p.jobs.filter((j) => j.state === 'busy').length;
  const summary = [attention ? `${attention} need a look` : 'all quiet', running ? `${running} running` : null, p.sabQ?.state === 'busy' ? `downloading ${p.sabQ.pct ?? 0}%` : null].filter(Boolean).join(' · ');
  if (!snap.updatedAt && !live) return null;

  return (
    <View style={styles.deck}>
      <Pressable style={styles.deckHead} onPress={toggle}>
        <View style={[t.dot(7), { backgroundColor: live ? t.colors.done : t.colors.idle }]} />
        <Text style={styles.deckTitle}>signals</Text>
        <Text style={styles.deckSummary} numberOfLines={1}>{summary}</Text>
        <Text style={styles.sub}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open && (
        <View style={{ gap: 8 }}>
          {(p.jobs.length > 0 || p.board) && (
            <Tile title="jobs" state={worst(p.jobs.length ? p.jobs : p.board ? [p.board] : [])} right={p.board?.detail}>
              {p.jobs.map((s) => <JobRow key={s.key} s={s} roster={roster} onSelect={onSelect} act={act} />)}
              {!p.jobs.length && <Text style={styles.sub}>nothing running</Text>}
              {!!p.board?.items?.length && (
                <Fold label={`${p.board.items.length} finished lately`}><ItemRows items={p.board.items} /></Fold>
              )}
            </Tile>
          )}
          {p.disk.length > 0 && (
            <Tile title="disk" state={worst(p.disk)} right={p.disk.length > 1 ? `${p.disk.length} volumes` : undefined}>
              {p.disk.map((s) => {
                const rate = s.rate ?? 0;
                const moving = Math.abs(rate) > 2e6;
                const c = moving ? (rate > 0 ? t.colors.done : t.colors.blocked) : t.colors.accent;
                return (
                  <View key={s.key} style={styles.block}>
                    <View style={styles.row}>
                      <Text style={styles.mono} numberOfLines={1}>{s.title}</Text>
                      <Text style={[styles.big, moving && { color: c }]}>{s.state === 'down' ? 'unreachable' : `${fmtBytes(s.value)} free`}</Text>
                      <Text style={styles.sub}>{s.total ? `of ${fmtBytes(s.total)}` : ''}</Text>
                    </View>
                    <Bar pct={s.pct} state={s.state} />
                    {!!s.history && s.history.length > 2 && <Sparkline points={s.history} color={c} height={22} />}
                    <Text style={styles.sub} numberOfLines={1}>{s.detail?.replace(/^[^·]*free of [^·]*(· )?/, '') || (s.remote ? 'nas' : '')}</Text>
                  </View>
                );
              })}
            </Tile>
          )}
          {(p.gpu.length > 0 || p.hosts.length > 0 || p.sys.length > 0) && (
            <Tile title="compute" state={worst([...p.gpu, ...p.hosts, ...p.sys])}>
              {p.gpu.map((g) => (
                <View key={g.key} style={styles.block}>
                  <View style={styles.row}>
                    <Text style={styles.strong}>{g.title}</Text>
                    <Text style={styles.big}>{g.value ?? 0}%</Text>
                    <Text style={styles.sub} numberOfLines={1}>{g.mem ? `${(g.mem.used / 1024).toFixed(1)} / ${(g.mem.total / 1024).toFixed(0)} GB` : ''}{g.temp != null ? ` · ${g.temp}°` : ''}{g.power != null ? ` · ${g.power} W` : ''}</Text>
                  </View>
                  <Bar pct={g.mem ? (g.mem.used / g.mem.total) * 100 : g.pct} state={g.state} />
                  {!!g.history && <Sparkline points={g.history} color={stateColor(t, g.state === 'ok' ? 'busy' : g.state)} floor={0} ceil={100} height={20} />}
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
                      {!!s.history && <Sparkline points={s.history} color={stateColor(t, s.state === 'ok' ? 'busy' : s.state)} floor={0} ceil={100} height={16} />}
                    </View>
                  ))}
                </View>
              )}
            </Tile>
          )}
          {p.sabQ && (
            <Tile title="downloads" state={p.sabQ.state} right={p.sabQ.host}>
              <View style={styles.row}>
                <Text style={[styles.big, p.sabQ.state === 'busy' && { color: t.colors.working }]}>{p.sabQ.state === 'busy' ? `${fmtBytes(p.sabQ.value)}/s` : p.sabQ.items?.length ? 'paused' : 'idle'}</Text>
                <Text style={[styles.sub, { flex: 1 }]} numberOfLines={1}>{p.sabQ.detail}</Text>
                {p.sabQ.actions?.map((a) => <Pill key={a} label={a} onPress={() => act(p.sabQ!.key, a)} />)}
              </View>
              {p.sabQ.state === 'busy' && !!p.sabQ.history && <Sparkline points={p.sabQ.history} color={t.colors.working} floor={0} height={20} />}
              {!!p.sabQ.items?.length && <ItemRows items={p.sabQ.items} />}
              {!!p.sabH?.items?.length && <Fold label={p.sabH.detail ?? 'history'}><ItemRows items={p.sabH.items} max={6} /></Fold>}
            </Tile>
          )}
          {p.printers.length > 0 && (
            <Tile title="printers" state={worst(p.printers)}>
              {p.printers.map((s) => {
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
                  <View key={s.key} style={styles.block}>
                    <View style={styles.row}>
                      <Text style={[styles.glyph, { color: stateColor(t, s.state) }]}>{GLYPH[s.state]}</Text>
                      <Text style={styles.strong}>{s.title}</Text>
                      <Text style={[styles.sub, { flex: 1 }]} numberOfLines={1}>{s.sub ?? ''}</Text>
                      {s.actions?.map((a) => <Pill key={a} label={a} tone={a === 'resume' ? 'hot' : 'plain'} onPress={() => act(s.key, a)} />)}
                    </View>
                    {(s.state === 'busy' || s.state === 'needs-you') && s.pct != null && <Bar pct={s.pct} state={s.state} />}
                    <View style={styles.row}>
                      {s.pct != null && s.state !== 'idle' && <Text style={styles.big}>{s.pct}%</Text>}
                      <Text style={[styles.sub, { flex: 1 }]} numberOfLines={2}>{s.detail}</Text>
                      {s.eta != null && s.state === 'busy' && <Text style={styles.sub}>~{fmtDur(s.eta)}</Text>}
                    </View>
                    {!!temps && <Text style={styles.sub} numberOfLines={1}>{temps}</Text>}
                    {fatal.length > 0 && <ItemRows items={fatal} />}
                    {hms.length > fatal.length && <Fold label={`${hms.length} HMS`}><ItemRows items={hms.filter((i) => i.state !== 'alarm')} max={20} /></Fold>}
                    {trays.length > 0 && (
                      <Fold label={s.feeding ? `feeding ${s.feeding.type ?? '?'}${s.feeding.remain != null && s.feeding.remain >= 0 ? ` · ${s.feeding.remain}% left` : ''}` : `${trays.length} trays`}>
                        <ItemRows items={trays} max={20} />
                      </Fold>
                    )}
                  </View>
                );
              })}
            </Tile>
          )}
          {p.services.length > 0 && (
            <Tile title="services" state={worst(p.services)} right={p.services.map((s) => `${s.items?.filter((i) => i.state === 'ok' || i.state === 'warn').length ?? 0} ${s.title}`).join(' · ')}>
              {p.services.map((s) => {
                const bad = (s.items ?? []).filter((i) => i.state === 'down' || i.state === 'warn');
                return (
                  <View key={s.key} style={{ gap: 4 }}>
                    {bad.length > 0 && <ItemRows items={bad} />}
                    <Fold label={`${s.title}: ${s.detail ?? ''}`}><ItemRows items={(s.items ?? []).filter((i) => !bad.includes(i))} max={40} /></Fold>
                  </View>
                );
              })}
            </Tile>
          )}
        </View>
      )}
    </View>
  );
}

const DECK_KEY = 'herdr.deckOpen';

/** The line under a session row: the recap when there is one, else the
 *  agent's last words. Blocked sessions lead with NEXT — the question. */
export function Beat({ beat, status }: { beat: Signal | undefined; status: string }) {
  const styles = useStyles(makeStyles);
  if (!beat) return null;
  const r = beat.recap;
  const now = r?.now || beat.said || beat.asked;
  if (!now) return null;
  const next = r?.next;
  const lead = status === 'blocked' && next ? next : now;
  const tail = status === 'blocked' && next ? now : next;
  return (
    <View style={styles.beat}>
      <Text style={[styles.beatNow, status === 'blocked' && styles.beatHot]} numberOfLines={2}>{lead}</Text>
      {!!tail && <Text style={styles.sub} numberOfLines={1}>{status === 'blocked' ? '' : '→ '}{tail}</Text>}
      <Text style={styles.beatMeta}>{beat.turns ? `${beat.turns} turn${beat.turns === 1 ? '' : 's'}` : ''}{beat.turnAt ? ` · ${agoShort(beat.turnAt)}` : ''}{r ? ' · ◆' : ''}</Text>
    </View>
  );
}

/** Up to four chips worth a glance from the list view. */
export function Meanwhile({ snap, onPress }: { snap: SignalSnapshot; onPress: () => void }) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const picks = useMemo(() => {
    const out: { key: string; text: string; state: SignalState }[] = [];
    for (const s of snap.signals) {
      if (s.source === 'herd') continue;
      if (s.state === 'needs-you' || s.state === 'alarm' || s.state === 'down' || s.state === 'warn') out.push({ key: s.key, text: s.kind === 'list' ? `${s.title}: ${s.detail ?? ''}` : s.title, state: s.state });
      else if (s.kind === 'job' && s.state === 'busy') out.push({ key: s.key, text: `${s.title}${s.pct != null ? ` ${s.pct}%` : ''}${s.eta ? ` ~${fmtDur(s.eta)}` : ''}`, state: 'busy' });
      else if (s.source === 'disk' && Math.abs(s.rate ?? 0) > 2e6) out.push({ key: s.key, text: `${s.title} ${(s.rate ?? 0) > 0 ? '↑' : '↓'} ${fmtBytes(Math.abs((s.rate ?? 0) * 60))}/min`, state: (s.rate ?? 0) > 0 ? 'ok' : 'warn' });
    }
    return out.sort((a, b) => RANK[a.state] - RANK[b.state]).slice(0, 4);
  }, [snap]);
  if (!picks.length) return null;
  return (
    <View style={styles.meanwhile}>
      {picks.map((p) => {
        const c = stateColor(t, p.state);
        return (
          <Pressable key={p.key} style={[styles.chip, { borderColor: alpha(c, 0.45), backgroundColor: alpha(c, 0.1) }]} onPress={onPress}>
            <Text style={[styles.glyph, { color: c }]}>{GLYPH[p.state]}</Text>
            <Text style={styles.chipText} numberOfLines={1}>{p.text}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
    deck: { gap: 8, marginBottom: 6 },
    deckHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
    deckTitle: { color: t.cyber ? t.colors.red : t.colors.text, fontSize: t.sz('ui', 12), ...t.font(t.cyber ? 'display' : 'ui', '700'), letterSpacing: 2, textTransform: 'uppercase' },
    deckSummary: { flex: 1, ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.sub, fontSize: t.sz('ui', 12) },
    tile: {
      backgroundColor: t.cyber ? alpha(t.colors.surface, 0.9) : t.colors.surface,
      borderRadius: t.radius.md,
      borderLeftWidth: 3,
      borderWidth: t.cyber ? 0 : 1,
      borderColor: t.colors.hairline,
      padding: 10,
      gap: 6,
    },
    tileHead: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
    tileTitle: { color: t.colors.text, fontSize: t.sz('ui', 12), ...t.font(t.cyber ? 'display' : 'ui', '700'), letterSpacing: 1.5, textTransform: 'uppercase' },
    tileRight: { flex: 1, textAlign: 'right', ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.sub, fontSize: t.sz('ui', 11) },
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
    beat: { paddingLeft: 18, paddingBottom: 6, gap: 1 },
    beatNow: { ...t.font('ui'), color: t.colors.text, fontSize: t.sz('ui', 12), lineHeight: undefined },
    beatHot: { color: t.colors.blocked, ...t.font('ui', '600') },
    beatMeta: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.sub, fontSize: t.sz('ui', 10) },
    scene: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.hairline },
    sceneChip: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: '47%', flex: 1, paddingHorizontal: 8, paddingVertical: 4, borderRadius: t.radius.sm, borderWidth: 1 },
    sceneRead: { ...t.font('ui', '600'), color: t.colors.text, fontSize: t.sz('ui', 12) },
    meanwhile: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingBottom: 6 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%', paddingHorizontal: 8, paddingVertical: 3, borderRadius: t.r(999), borderWidth: 1 },
    chipText: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.text, fontSize: t.sz('ui', 11), flexShrink: 1 },
  });

// ---------- scene strip: what's on stage for one chat ----------

function reading(s: Signal, item: string | null): { text: string; pct: number | null; state: SignalState } {
  if (item && s.items) {
    const i = s.items.find((x) => x.id === item);
    if (i) return { text: `${i.label} ${i.sub ?? ''}`.trim(), pct: null, state: i.state ?? s.state };
  }
  if (s.kind === 'job') {
    const n = s.done != null && s.total ? `${Math.round(s.done)}/${Math.round(s.total)}` : s.pct != null ? `${s.pct}%` : '';
    return { text: `${s.title} ${n}${s.eta && s.state === 'busy' ? ` ~${fmtDur(s.eta)}` : ''}${s.state === 'needs-you' ? ' · needs you' : s.state === 'alarm' ? ' · failed' : ''}`.trim(), pct: s.pct ?? null, state: s.state };
  }
  if (s.source === 'disk') {
    const rate = s.rate ?? 0;
    const mv = Math.abs(rate) > 2e6 ? ` ${rate > 0 ? '↑' : '↓'}${fmtBytes(Math.abs(rate) * 60)}/min` : '';
    return { text: `${s.title} ${fmtBytes(s.value)} free${mv}`, pct: s.pct ?? null, state: s.state };
  }
  if (s.source === 'gpu') return { text: `${s.title} ${s.value ?? 0}% · ${s.mem ? `${(s.mem.used / 1024).toFixed(1)}/${(s.mem.total / 1024).toFixed(0)} GB` : ''}`, pct: s.mem ? (s.mem.used / s.mem.total) * 100 : null, state: s.state };
  if (s.kind === 'list') return { text: `${s.title}: ${s.detail ?? ''}`, pct: null, state: s.state };
  return { text: `${s.title} ${s.detail ?? ''}`.trim(), pct: null, state: s.state };
}

/** The director's picks for this chat, as live chips under the header.
 *  Nothing on a quiet session. */
export function SceneStrip({ snap, paneId, onPress }: { snap: SignalSnapshot; paneId: string; onPress: () => void }) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const scene = snap.signals.find((s) => s.key === `scene:${paneId}` || s.key.startsWith(`scene:${paneId}@`));
  if (!scene?.items?.length) return null;
  const host = paneId.split('@')[1];
  const byKey = new Map(snap.signals.map((s) => [s.key, s]));
  const stage = scene.items
    .map((i) => {
      const sig = byKey.get(i.id) ?? (host ? byKey.get(`${i.id}@${host}`) : undefined);
      return sig ? { sig, why: i.label, item: i.item ?? null } : null;
    })
    .filter((x): x is { sig: Signal; why: string; item: string | null } => !!x);
  if (!stage.length) return null;
  return (
    <View style={styles.scene}>
      {stage.map(({ sig, why, item }) => {
        const r = reading(sig, item);
        const c = stateColor(t, r.state);
        return (
          <Pressable key={sig.key} style={[styles.sceneChip, { borderColor: alpha(c, 0.4), backgroundColor: alpha(c, 0.07) }]} onPress={onPress}>
            <Text style={[styles.glyph, { color: c }]}>{GLYPH[r.state] ?? '●'}</Text>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={styles.sceneRead} numberOfLines={1}>{r.text}</Text>
              {r.pct != null && <Bar pct={r.pct} state={r.state} />}
              <Text style={styles.beatMeta} numberOfLines={1}>{why}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

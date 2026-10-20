/* The ＋ sheet, place-first like the web launcher: where you're going is
   one row (tap to change), the agent is one tap, and everything rarely
   touched folds under "options". Built on shared/src/launcher.ts. */
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  MODE_KINDS,
  RESUME_KINDS,
  SPAWN_MODES,
  SPAWN_MODE_ORDER,
  agoShort,
  ago,
  basename,
  buildPlaces,
  buildSpawnRequest,
  cleanAgentName,
  describeDest,
  destKey,
  errorOf,
  get,
  initialDest,
  lastKind,
  lastMode,
  placeDest,
  post,
  rememberKind,
  rememberMode,
  shortPath,
  type AgentKind,
  type Dest,
  type Place,
  type Project,
  type Roster,
  type SessionEntry,
  type SpawnMode,
  type SpawnTarget,
  type WorktreeEntry,
} from '@herdr/shared';
import { Brackets } from '../cyber';
import { ChamferPlate } from '../cyber-skia';
import { alpha, useStyles, useTheme, type Tokens } from '../theme';
import { Icon } from './Icon';

type Session = SessionEntry & { dir: string; kind: string };

export function NewChatSheet({
  roster,
  target,
  onClose,
  onCreated,
}: {
  roster: Roster;
  /** pre-aim: a space's ＋, or the chat you're looking at */
  target?: SpawnTarget;
  onClose: () => void;
  onCreated: (paneId: string) => void;
}) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const [kinds, setKinds] = useState<AgentKind[] | null>(null);
  const [kind, setKind] = useState('');
  const [projects, setProjects] = useState<Project[] | null>(null);
  // repo path -> its checkouts (fetched when a place is expanded)
  const [worktrees, setWorktrees] = useState<Record<string, WorktreeEntry[] | null>>({});
  // place key -> resumable sessions across the place's dirs
  const [sessions, setSessions] = useState<Record<string, Session[] | null>>({});
  const [openPlace, setOpenPlace] = useState<string | null>(null);
  const places = useMemo(() => buildPlaces(roster, projects), [roster, projects]);
  const [dest, setDest] = useState<Dest>(() => initialDest(roster, target));
  // the place list stays folded when we already know where you're going
  const [picking, setPicking] = useState(() => dest.type === 'path');
  const [filter, setFilter] = useState('');
  const [cwd, setCwd] = useState(target?.cwd && dest.type === 'path' ? target.cwd : '');
  const [branch, setBranch] = useState('');
  const [name, setName] = useState('');
  const [argsText, setArgsText] = useState('');
  const [spawnMode, setSpawnMode] = useState<SpawnMode>('default');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    get('/api/kinds')
      .then((r) => r.json())
      .then((j: { kinds: AgentKind[] }) => {
        if (!alive) return;
        const sorted = [...j.kinds].sort(
          (a, b) => Number(b.installed) - Number(a.installed) || a.kind.localeCompare(b.kind),
        );
        setKinds(sorted);
        setKind(
          (k) =>
            k ||
            sorted.find((x) => x.kind === lastKind() && x.installed)?.kind ||
            sorted.find((x) => x.installed)?.kind ||
            '',
        );
      })
      .catch(() => alive && setError("couldn't load agent kinds"));
    get('/api/projects')
      .then((r) => r.json())
      .then((j: { projects: Project[] }) => alive && setProjects(j.projects))
      .catch(() => alive && setProjects([]));
    return () => {
      alive = false;
    };
  }, []);

  // each kind remembers its own last permission mode
  useEffect(() => {
    if (kind) setSpawnMode(lastMode(kind));
  }, [kind]);

  // expanding a place pulls its checkouts and resumable sessions once
  const expand = (p: Place) => {
    const next = openPlace === p.key ? null : p.key;
    setOpenPlace(next);
    if (!next) return;
    if (p.repo && worktrees[p.path] === undefined) {
      setWorktrees((w) => ({ ...w, [p.path]: null }));
      get(`/api/worktrees?cwd=${encodeURIComponent(p.path)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((j: { worktrees: WorktreeEntry[] }) => setWorktrees((w) => ({ ...w, [p.path]: j.worktrees })))
        .catch(() => setWorktrees((w) => ({ ...w, [p.path]: [] })));
    }
    if (sessions[p.key] === undefined) {
      setSessions((s) => ({ ...s, [p.key]: null }));
      Promise.all(
        p.dirs.flatMap((d) =>
          RESUME_KINDS.map((k) =>
            get(`/api/sessions?cwd=${encodeURIComponent(d)}&kind=${k}`)
              .then((r) => (r.ok ? r.json() : Promise.reject()))
              .then((j: { sessions: SessionEntry[] }) => j.sessions.map((s) => ({ ...s, dir: d, kind: k })))
              .catch(() => [] as Session[]),
          ),
        ),
      ).then((lists) => {
        const merged = lists.flat().sort((a, b) => b.mtime - a.mtime).slice(0, 8);
        setSessions((s) => ({ ...s, [p.key]: merged }));
      });
    }
  };

  const pickDest = (d: Dest) => {
    setDest(d);
    if (d.type !== 'worktree-new') setPicking(false);
  };

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? places.filter((p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)) : places;
  }, [places, filter]);

  // a resume row already knows its agent kind — the kind picker is moot
  const isResume = dest.type === 'resume';
  const effKind = dest.type === 'resume' ? dest.kind : kind;
  const { name: destName, how: destHow, place: destPlace } = describeDest(dest, roster, places, cwd);
  const key = destKey(dest);

  const submit = async () => {
    if (!effKind || busy) return;
    const body = buildSpawnRequest({ dest, kind: effKind, spawnMode, name, argsText, cwd, branch });
    if ('error' in body) {
      setError(body.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await post('/api/chats', body);
      if (!r.ok) throw new Error(await errorOf(r));
      rememberKind(effKind);
      if (MODE_KINDS.includes(effKind)) rememberMode(effKind, spawnMode);
      const { paneId } = (await r.json()) as { paneId: string };
      onCreated(paneId);
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setBusy(false);
    }
  };

  const row = (d: Dest, label: string, extra?: string, opts: { live?: boolean; onPick?: () => void; icon?: 'focus' | 'folder' | 'history' } = {}) => {
    const on = key === destKey(d);
    return (
      <Pressable
        key={destKey(d)}
        style={[styles.dest, on && styles.destOn]}
        onPress={() => {
          pickDest(d);
          opts.onPick?.();
        }}
      >
        {!!opts.icon && <Icon name={opts.icon} size={13} color={on ? t.colors.accent : t.colors.sub} />}
        <Text style={[styles.destLabel, on && styles.destLabelOn]} numberOfLines={1}>
          {label}
        </Text>
        {!!extra && (
          <Text style={[styles.destExtra, opts.live && styles.live]} numberOfLines={1}>
            {extra}
          </Text>
        )}
      </Pressable>
    );
  };

  // Past sessions under an expanded place. A session already bound to a live
  // pane can't be resumed twice — its row jumps there instead.
  const sessionRows = (p: Place) => {
    const list = sessions[p.key];
    if (list === null) return <Text style={styles.note}>loading sessions…</Text>;
    if (!list?.length) return null;
    return (
      <>
        <Text style={styles.subSec}>resume</Text>
        {list.map((s) => {
          const label = s.title ?? s.firstPrompt ?? s.sessionId.slice(0, 8);
          return s.livePaneId ? (
            <Pressable key={s.sessionId} style={styles.dest} onPress={() => onCreated(s.livePaneId!)}>
              <Icon name="history" size={13} color={t.colors.sub} />
              <Text style={styles.destLabel} numberOfLines={1}>
                {label}
              </Text>
              <Text style={[styles.destExtra, styles.live]}>live</Text>
            </Pressable>
          ) : (
            row(
              { type: 'resume', dir: s.dir, sessionId: s.sessionId, title: s.title, kind: s.kind },
              label,
              `${s.kind} · ${ago(s.mtime)}`,
              { icon: 'history' },
            )
          );
        })}
      </>
    );
  };

  const details = (p: Place) => {
    const wts = worktrees[p.path];
    const subs = (wts ?? []).filter((w) => w.path !== p.path);
    return (
      <View style={styles.subs}>
        {p.spaces.map((w) =>
          row(
            placeDest({ ...p, spaces: [w] }, roster),
            `new tab in space ${w.number}${w.label && w.label !== p.name ? ` · ${w.label}` : ''}`,
            undefined,
            { icon: 'focus' },
          ),
        )}
        {row({ type: 'project', path: p.path }, p.spaces.length ? 'fresh space' : 'start here', shortPath(p.path))}
        {p.repo && (
          <>
            {wts === null && <Text style={styles.note}>loading worktrees…</Text>}
            {subs.map((w) =>
              row(
                { type: 'worktree-open', repoCwd: p.path, path: w.path },
                `⎇ ${w.branch ?? w.label}`,
                w.openWorkspaceId ? 'open' : basename(w.path),
                { live: !!w.openWorkspaceId },
              ),
            )}
            {row({ type: 'worktree-new', repoCwd: p.path }, '⎇ new worktree…')}
            {key === `wtnew:${p.path}` && (
              <TextInput
                style={styles.branch}
                value={branch}
                onChangeText={setBranch}
                placeholder="branch name"
                placeholderTextColor={t.colors.sub}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
              />
            )}
          </>
        )}
        {sessionRows(p)}
      </View>
    );
  };

  const optSummary = [
    MODE_KINDS.includes(effKind) && !isResume && spawnMode !== 'default' ? SPAWN_MODES[spawnMode].label : null,
    name.trim() ? `“${name.trim()}”` : null,
    argsText.trim() ? '+args' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const startLabel = busy
    ? isResume
      ? 'resuming…'
      : `starting ${effKind}…`
    : isResume
      ? `resume in ${destPlace?.name ?? basename(dest.type === 'resume' ? dest.dir : '')}`
      : `start ${effKind || 'chat'} in ${destName}`;

  return (
    // the sheet covers the status bar on iOS 26 and Android alike: pad the
    // top from the view's own safe area (zero when the sheet is inset)
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.head}>
        <Text style={styles.title}>new chat</Text>
        <Pressable onPress={onClose} hitSlop={12} disabled={busy} accessibilityLabel="close">
          <Icon name="close" size={22} color={t.colors.sub} />
        </Pressable>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* where: the pick, as one row; tap to change */}
        <Pressable style={[styles.where, picking && styles.whereOpen]} onPress={() => setPicking((v) => !v)}>
          <Brackets color={picking ? t.colors.accent : alpha(t.colors.accent, 0.5)} />
          <View style={styles.whereMain}>
            <Text style={styles.whereName} numberOfLines={1}>
              {isResume ? `↻ ${destName}` : destName}
            </Text>
            <Text style={styles.whereHow} numberOfLines={1}>
              {destHow}
              {destPlace && destPlace.live > 0 && !isResume ? ` · ${destPlace.live} live` : ''}
            </Text>
          </View>
          <Text style={styles.whereChange}>{picking ? 'done' : 'change'}</Text>
        </Pressable>

        {picking && (
          <View style={styles.picker}>
            <TextInput
              style={styles.filter}
              value={filter}
              onChangeText={setFilter}
              onSubmitEditing={() => shown[0] && pickDest(placeDest(shown[0], roster))}
              placeholder="filter places…"
              placeholderTextColor={t.colors.sub}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
            />
            {projects === null && places.length === 0 && <Text style={styles.note}>loading…</Text>}
            {shown.map((p) => {
              const open = openPlace === p.key;
              const here = destPlace?.key === p.key;
              return (
                <View key={p.key}>
                  <View style={[styles.placeRow, here && !open && styles.destOn]}>
                    <Pressable style={styles.placePick} onPress={() => pickDest(placeDest(p, roster))}>
                      {p.repo && <Text style={styles.badge}>⎇</Text>}
                      <Text style={[styles.destLabel, here && !open && styles.destLabelOn]} numberOfLines={1}>
                        {p.name}
                      </Text>
                      {p.live > 0 && <Text style={[styles.badge, styles.live]}>{p.live} live</Text>}
                      {p.lastActive > 0 && <Text style={styles.badge}>{agoShort(p.lastActive)}</Text>}
                    </Pressable>
                    <Pressable
                      style={styles.placeChev}
                      onPress={() => expand(p)}
                      hitSlop={6}
                      accessibilityLabel={`more ways to start in ${p.name}`}
                    >
                      <Icon name={open ? 'chevron-down' : 'chevron-right'} size={18} color={open ? t.colors.accent : t.colors.sub} />
                    </Pressable>
                  </View>
                  {open && details(p)}
                </View>
              );
            })}
            <TextInput
              style={[styles.input, key === 'path' && styles.destOn]}
              value={cwd}
              onFocus={() => setDest({ type: 'path' })}
              onChangeText={setCwd}
              placeholder="other folder… (~ if blank)"
              placeholderTextColor={t.colors.sub}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {key === 'path' && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} keyboardShouldPersistTaps="handled">
                {places.flatMap((p) => p.dirs).map((d) => (
                  <Pressable key={d} style={styles.chip} onPress={() => setCwd(d)}>
                    <Text style={styles.chipText} numberOfLines={1}>
                      {shortPath(d)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        )}

        {/* agent: one tap, remembers the last */}
        {isResume ? (
          <Text style={styles.hint}>resuming a {effKind} session</Text>
        ) : (
          <View style={styles.kindRow}>
            {!kinds && <ActivityIndicator color={t.colors.accent} />}
            {kinds
              ?.filter((k) => k.installed)
              .map((k) => (
                <Pressable
                  key={k.kind}
                  style={[styles.seg, kind === k.kind && styles.segOn]}
                  onPress={() => setKind(k.kind)}
                  accessibilityState={{ selected: kind === k.kind }}
                >
                  <Text style={[styles.segText, kind === k.kind && styles.segTextOn]}>{k.kind}</Text>
                </Pressable>
              ))}
          </View>
        )}

        {/* the rarely-touched stuff, summarized when it's not default */}
        <Pressable style={styles.optToggle} onPress={() => setOptionsOpen((v) => !v)}>
          <Icon name={optionsOpen ? 'chevron-down' : 'chevron-right'} size={14} color={t.colors.sub} />
          <Text style={styles.optToggleText}>
            options
            {!!optSummary && <Text style={styles.hint}> · {optSummary}</Text>}
          </Text>
        </Pressable>
        {optionsOpen && (
          <View style={styles.options}>
            {MODE_KINDS.includes(effKind) && !isResume && (
              <>
                <Text style={styles.sec}>permission mode</Text>
                <View style={styles.kindRow}>
                  {SPAWN_MODE_ORDER.map((m) => (
                    <Pressable key={m} style={[styles.seg, spawnMode === m && styles.segOn]} onPress={() => setSpawnMode(m)}>
                      <Text style={[styles.segText, spawnMode === m && styles.segTextOn]}>{SPAWN_MODES[m].label}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.hint}>{SPAWN_MODES[spawnMode].hint}</Text>
              </>
            )}
            <Text style={styles.sec}>name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="optional — names the tab & agent"
              placeholderTextColor={t.colors.sub}
              autoCorrect={false}
            />
            {!!name.trim() && cleanAgentName(name) !== name.trim() && (
              <Text style={styles.hint}>
                agent runs as <Text style={styles.mono}>{cleanAgentName(name) || 'auto'}</Text> — tab keeps “{name.trim()}”
              </Text>
            )}
            <Text style={styles.sec}>extra args</Text>
            <TextInput
              style={[styles.input, styles.mono]}
              value={argsText}
              onChangeText={setArgsText}
              placeholder="optional — passed through verbatim"
              placeholderTextColor={t.colors.sub}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        )}

        {!!error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      <View style={styles.foot}>
        <Pressable style={[styles.btnPrimary, t.cyber && styles.btnPlate, (busy || !effKind) && styles.btnDisabled]} disabled={busy || !effKind} onPress={submit}>
          <ChamferPlate fill={t.colors.hot} stroke="#ffffff55" cut={14} glow={8} />
          {busy ? (
            <ActivityIndicator color={t.colors.accentInk} />
          ) : (
            <Text style={styles.btnPrimaryText} numberOfLines={1}>
              {startLabel}
            </Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
    root: { flex: 1 },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.colors.hairline,
      backgroundColor: t.cyber ? alpha(t.colors.bg, 0.8) : t.colors.surface,
      borderTopWidth: t.cyber ? 2 : 0,
      borderTopColor: t.colors.red,
    },
    title: t.cyber
      ? { color: t.colors.red, fontSize: 15, ...t.font('display', '900'), letterSpacing: 3, textTransform: 'uppercase', ...t.glow(t.colors.red, 12) }
      : { color: t.colors.text, fontSize: 18, ...t.font('ui', '700') },

    scroll: { flex: 1 },
    scrollContent: { padding: 14, paddingBottom: 40, gap: 10 },

    where: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 14,
      backgroundColor: t.cyber ? alpha(t.colors.accent, 0.06) : t.colors.surface,
      borderRadius: t.radius.md,
      borderWidth: 1,
      borderColor: t.cyber ? alpha(t.colors.accent, 0.25) : t.colors.hairline,
    },
    whereOpen: { borderColor: t.colors.accent, ...t.boxGlow(t.colors.accent, 16, 0.35) },
    whereMain: { flex: 1, minWidth: 0, gap: 2 },
    whereName: { color: t.colors.text, fontSize: 17, ...t.font('ui', '700'), ...t.phosphor },
    whereHow: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.sub, fontSize: 12 },
    whereChange: { color: t.colors.accent, fontSize: 12, ...t.font('ui', '700'), ...t.hud, ...t.glow(t.colors.accent, 6) },

    picker: { gap: 4 },
    filter: {
      backgroundColor: t.cyber ? alpha('#000000', 0.45) : t.colors.surface,
      borderRadius: t.radius.sm,
      color: t.colors.text,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: t.cyber ? alpha(t.colors.accent, 0.25) : t.colors.hairline,
      ...t.font('input'),
      fontSize: 15,
      marginBottom: 4,
    },
    placeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.glass,
      borderRadius: t.radius.sm,
      borderWidth: 1,
      borderColor: t.colors.hairline,
      borderLeftWidth: t.cyber ? 2 : 1,
      borderLeftColor: t.cyber ? 'transparent' : t.colors.hairline,
    },
    placePick: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 13, minWidth: 0 },
    placeChev: { width: 44, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: t.colors.hairline },
    dest: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: t.glass,
      borderRadius: t.radius.sm,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: t.colors.hairline,
      borderLeftWidth: t.cyber ? 2 : 1,
      borderLeftColor: t.cyber ? 'transparent' : t.colors.hairline,
      marginBottom: 4,
    },
    destOn: t.cyber
      ? { borderColor: 'transparent', borderLeftColor: t.colors.accent, backgroundColor: alpha(t.colors.accent, 0.12) }
      : { borderColor: t.colors.accent, backgroundColor: t.colors.surface2 },
    destLabel: { color: t.colors.text, fontSize: 14, ...t.font('ui', '600'), flex: 1 },
    destLabelOn: { color: t.colors.accent, ...t.glow(t.colors.accent, 6) },
    destExtra: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.sub, fontSize: 11, maxWidth: '45%' },
    badge: { ...t.font(t.cyber ? 'mono' : 'ui'), ...t.hud, color: t.colors.sub, fontSize: 10 },
    live: { color: t.colors.working, ...t.glow(t.colors.working, 6) },
    subs: { paddingLeft: 12, paddingTop: 4, marginBottom: 4 },
    subSec: { ...t.font('ui', '700'), ...t.hud, color: t.colors.sub, fontSize: 10, marginTop: 6, marginBottom: 4 },
    note: { ...t.font('ui'), color: t.colors.sub, fontSize: 13, paddingVertical: 6 },
    branch: {
      backgroundColor: t.cyber ? alpha('#000000', 0.45) : t.colors.surface2,
      borderWidth: t.cyber ? 1 : 0,
      borderColor: alpha(t.colors.accent, 0.25),
      borderRadius: t.radius.sm,
      color: t.colors.text,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 4,
      ...t.font('mono'),
    },
    input: {
      backgroundColor: t.cyber ? alpha('#000000', 0.45) : t.colors.surface,
      borderRadius: t.radius.sm,
      color: t.colors.text,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: t.cyber ? alpha(t.colors.accent, 0.25) : t.colors.hairline,
      ...t.font('input'),
      fontSize: 15,
    },
    chips: { marginTop: 6, maxHeight: 36 },
    chip: {
      backgroundColor: t.cyber ? 'transparent' : t.colors.surface3,
      borderWidth: t.cyber ? 1 : 0,
      borderColor: alpha(t.colors.accent, 0.3),
      borderRadius: t.r(999),
      paddingHorizontal: 10,
      paddingVertical: 6,
      marginRight: 6,
    },
    chipText: { ...t.font('ui'), ...t.hud, color: t.colors.sub, fontSize: t.cyber ? 11 : 12 },

    kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    seg: {
      backgroundColor: t.cyber ? 'transparent' : t.colors.surface,
      borderRadius: t.radius.sm,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: t.cyber ? alpha(t.colors.accent, 0.3) : t.colors.hairline,
    },
    segOn: t.cyber
      ? { borderColor: t.colors.accent, backgroundColor: alpha(t.colors.accent, 0.16), ...t.boxGlow(t.colors.accent, 14) }
      : { borderColor: t.colors.accent, backgroundColor: t.colors.surface2 },
    segText: { color: t.colors.text, ...t.font('ui', '600'), ...t.hud, fontSize: t.cyber ? 12 : 14 },
    segTextOn: { color: t.colors.accent, ...t.glow(t.colors.accent, 8) },

    optToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
    optToggleText: { color: t.colors.sub, fontSize: 12, ...t.font('ui', '700'), ...t.hud },
    options: { gap: 6, paddingLeft: 4 },
    sec: {
      color: t.cyber ? t.colors.red : t.colors.sub,
      fontSize: 11,
      ...t.font('ui', '700'),
      textTransform: 'uppercase',
      ...t.hud,
      opacity: t.cyber ? 0.85 : 1,
      marginTop: 8,
    },
    hint: { ...t.font('ui'), color: t.colors.sub, fontSize: 12 },
    mono: { ...t.font('mono') },
    error: {
      ...t.font(t.cyber ? 'mono' : 'ui'),
      color: t.cyber ? t.colors.red : t.colors.blocked,
      backgroundColor: alpha(t.cyber ? t.colors.red : t.colors.blocked, 0.12),
      borderWidth: t.cyber ? 1 : 0,
      borderColor: alpha(t.colors.red, 0.3),
      padding: 10,
      borderRadius: t.radius.sm,
    },
    foot: {
      padding: 14,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.colors.hairline,
      backgroundColor: t.cyber ? alpha(t.colors.bg, 0.84) : t.colors.surface,
    },
    btnPrimary: {
      paddingVertical: 15,
      paddingHorizontal: 16,
      alignItems: 'center',
      borderRadius: t.radius.md,
      backgroundColor: t.cyber ? t.colors.hot : t.colors.accent,
      ...t.boxGlow(t.colors.hot, 16, 0.5),
    },
    btnPrimaryText: { color: t.cyber ? '#000000' : t.colors.accentInk, ...t.font('ui', '700'), fontSize: t.cyber ? 14 : 16, ...t.hud },
    btnPlate: { backgroundColor: 'transparent', boxShadow: undefined },
    btnDisabled: { opacity: 0.45 },
  });

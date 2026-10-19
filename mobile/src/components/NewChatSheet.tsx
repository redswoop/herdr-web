import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  cleanAgentName,
  errorOf,
  get,
  lastKind,
  post,
  rememberKind,
  type AgentKind,
  type NewChatRequest,
  type Project,
  type Roster,
  type SpawnTarget,
  type WorktreeEntry,
} from '@herdr/shared';
import { alpha, useStyles, useTheme, type Tokens } from '../theme';
import { Icon } from './Icon';

type Dest =
  | { type: 'workspace'; workspaceId: string; cwd?: string }
  | { type: 'project'; path: string }
  | { type: 'worktree-open'; repoCwd: string; path: string }
  | { type: 'worktree-new'; repoCwd: string }
  | { type: 'path' };

const destKey = (d: Dest) =>
  d.type === 'workspace'
    ? `ws:${d.workspaceId}`
    : d.type === 'project'
      ? `proj:${d.path}`
      : d.type === 'worktree-open'
        ? `wt:${d.path}`
        : d.type === 'worktree-new'
          ? `wtnew:${d.repoCwd}`
          : 'path';

const basename = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;
const shortPath = (p: string) => p.replace(/^\/home\/[^/]+/, '~');

export function NewChatSheet({
  roster,
  target,
  onClose,
  onCreated,
}: {
  roster: Roster;
  target?: SpawnTarget;
  onClose: () => void;
  onCreated: (paneId: string) => void;
}) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const workspaces = roster.workspaces ?? [];
  const [kinds, setKinds] = useState<AgentKind[] | null>(null);
  const [kind, setKind] = useState('');
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [worktrees, setWorktrees] = useState<Record<string, WorktreeEntry[] | null>>({});
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [dest, setDest] = useState<Dest>(() => {
    const w = target?.workspaceId
      ? workspaces.find((x) => x.workspaceId === target.workspaceId)
      : (workspaces.find((x) => x.focused) ?? workspaces[0]);
    if (target?.cwd && !w) return { type: 'path' };
    return w
      ? {
          type: 'workspace',
          workspaceId: w.workspaceId,
          cwd: target?.cwd ?? w.worktree?.checkoutPath ?? undefined,
        }
      : { type: 'path' };
  });
  const [cwd, setCwd] = useState(target?.cwd ?? '');
  const [branch, setBranch] = useState('');
  const [name, setName] = useState('');
  const [argsText, setArgsText] = useState('');
  const [yolo, setYolo] = useState(false);
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

  const openRepo = (p: Project) => {
    const next = openProject === p.key ? null : p.key;
    setOpenProject(next);
    if (next) setDest({ type: 'project', path: p.path });
    if (next && p.repo && worktrees[p.path] === undefined) {
      setWorktrees((w) => ({ ...w, [p.path]: null }));
      get(`/api/worktrees?cwd=${encodeURIComponent(p.path)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((j: { worktrees: WorktreeEntry[] }) =>
          setWorktrees((w) => ({ ...w, [p.path]: j.worktrees })),
        )
        .catch(() => setWorktrees((w) => ({ ...w, [p.path]: [] })));
    }
  };

  const cwdSuggestions = useMemo(() => {
    const dirs = new Set<string>();
    for (const a of roster.agents) if (a.cwd) dirs.add(a.cwd);
    for (const p of projects ?? []) for (const d of p.dirs) dirs.add(d);
    return [...dirs].sort().slice(0, 8);
  }, [roster, projects]);

  const submit = async () => {
    if (!kind || busy) return;
    setBusy(true);
    setError(null);
    const args = [
      ...(kind === 'claude' && yolo ? ['--dangerously-skip-permissions'] : []),
      ...(argsText.trim() ? argsText.trim().split(/\s+/) : []),
    ];
    const body: NewChatRequest = {
      kind,
      name: name.trim() || undefined,
      label: name.trim() || undefined,
      args: args.length ? args : undefined,
    };
    if (dest.type === 'workspace') {
      body.workspaceId = dest.workspaceId;
      body.cwd = dest.cwd;
    } else if (dest.type === 'project') {
      body.cwd = dest.path;
    } else if (dest.type === 'worktree-open') {
      body.worktree = { repoCwd: dest.repoCwd, path: dest.path };
    } else if (dest.type === 'worktree-new') {
      if (!branch.trim()) {
        setError('branch name required for a new worktree');
        setBusy(false);
        return;
      }
      body.worktree = { repoCwd: dest.repoCwd, branch: branch.trim() };
    } else {
      body.cwd = cwd.trim() || undefined;
    }
    try {
      const r = await post('/api/chats', body);
      if (!r.ok) throw new Error(await errorOf(r));
      rememberKind(kind);
      const { paneId } = (await r.json()) as { paneId: string };
      onCreated(paneId);
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setBusy(false);
    }
  };

  const key = destKey(dest);

  const DestRow = ({
    d,
    label,
    extra,
    onPick,
  }: {
    d: Dest;
    label: string;
    extra?: string;
    onPick?: () => void;
  }) => {
    const styles = useStyles(makeStyles);
    const on = key === destKey(d);
    return (
      <Pressable
        style={[styles.dest, on && styles.destOn]}
        onPress={() => {
          setDest(d);
          onPick?.();
        }}
      >
        <Text style={[styles.destLabel, on && styles.destLabelOn]} numberOfLines={1}>
          {label}
        </Text>
        {!!extra && (
          <Text style={styles.destExtra} numberOfLines={1}>
            {extra}
          </Text>
        )}
      </Pressable>
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Text style={styles.title}>new chat</Text>
        <Pressable onPress={onClose} hitSlop={12} disabled={busy} accessibilityLabel="close">
          <Icon name="close" size={22} color={t.colors.sub} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {workspaces.length > 0 && <Text style={styles.sec}>open workspaces</Text>}
        {workspaces.map((w) => (
          <DestRow
            key={w.workspaceId}
            d={{
              type: 'workspace',
              workspaceId: w.workspaceId,
              cwd: w.worktree?.checkoutPath ?? undefined,
            }}
            label={`${w.label || `workspace ${w.number}`}`}
            extra={w.worktree?.isLinked ? `git · ${w.worktree.repoName}` : undefined}
          />
        ))}

        <Text style={styles.sec}>projects — fresh workspace</Text>
        {projects === null && <Text style={styles.note}>loading…</Text>}
        {projects?.map((p) => {
          const open = openProject === p.key;
          const wts = worktrees[p.path];
          const subs = (wts ?? []).filter((t) => t.path !== p.path);
          return (
            <View key={p.key}>
              <Pressable
                style={[styles.dest, !open && key === `proj:${p.path}` && styles.destOn]}
                onPress={() => openRepo(p)}
              >
                <View style={styles.destLabelRow}>
                  {p.repo ? <Icon name="folder" size={14} color={t.colors.accent} /> : null}
                  <Text style={styles.destLabel} numberOfLines={1}>
                    {p.name}
                    {p.live > 0 ? ` · ${p.live} live` : ''}
                  </Text>
                </View>
                <Text style={styles.destExtra} numberOfLines={1}>
                  {shortPath(p.path)}
                </Text>
              </Pressable>
              {open && (
                <View style={styles.subs}>
                  <DestRow
                    d={{ type: 'project', path: p.path }}
                    label={p.repo ? 'main checkout' : 'start here'}
                    extra={shortPath(p.path)}
                  />
                  {p.repo && wts === null && <Text style={styles.note}>loading worktrees…</Text>}
                  {p.repo &&
                    subs.map((t) => (
                      <DestRow
                        key={t.path}
                        d={{ type: 'worktree-open', repoCwd: p.path, path: t.path }}
                        label={t.branch ?? t.label}
                        extra={t.openWorkspaceId ? 'open' : basename(t.path)}
                      />
                    ))}
                  {p.repo && (
                    <>
                      <DestRow d={{ type: 'worktree-new', repoCwd: p.path }} label="+ new worktree" />
                      {key === `wtnew:${p.path}` && (
                        <TextInput
                          style={styles.branch}
                          value={branch}
                          onChangeText={setBranch}
                          placeholder="branch name"
                          placeholderTextColor={t.colors.sub}
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                      )}
                    </>
                  )}
                </View>
              )}
            </View>
          );
        })}

        <Text style={styles.sec}>elsewhere</Text>
        <TextInput
          style={[styles.input, key === 'path' && styles.destOn]}
          value={cwd}
          onFocus={() => setDest({ type: 'path' })}
          onChangeText={setCwd}
          placeholder="~ (herdr default)"
          placeholderTextColor={t.colors.sub}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {cwdSuggestions.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
            {cwdSuggestions.map((d) => (
              <Pressable
                key={d}
                style={styles.chip}
                onPress={() => {
                  setCwd(d);
                  setDest({ type: 'path' });
                }}
              >
                <Text style={styles.chipText} numberOfLines={1}>
                  {shortPath(d)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        <Text style={styles.sec}>agent</Text>
        <View style={styles.kindRow}>
          {(kinds ?? []).map((k) => (
            <Pressable
              key={k.kind}
              disabled={!k.installed}
              style={[
                styles.kindChip,
                kind === k.kind && styles.kindOn,
                !k.installed && styles.kindOff,
              ]}
              onPress={() => setKind(k.kind)}
            >
              <Text
                style={[
                  styles.kindText,
                  kind === k.kind && styles.kindTextOn,
                  !k.installed && styles.kindTextOff,
                ]}
              >
                {k.kind}
              </Text>
            </Pressable>
          ))}
          {!kinds && <ActivityIndicator color={t.colors.accent} />}
        </View>

        <Text style={styles.sec}>name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="optional — tab & agent name"
          placeholderTextColor={t.colors.sub}
          autoCorrect={false}
        />
        {!!name.trim() && cleanAgentName(name) !== name.trim() && (
          <Text style={styles.hint}>
            agent runs as <Text style={styles.mono}>{cleanAgentName(name) || 'auto'}</Text> — tab
            keeps “{name.trim()}”
          </Text>
        )}

        {kind === 'claude' && (
          <View style={styles.checkRow}>
            <Switch
              value={yolo}
              onValueChange={setYolo}
              trackColor={{ true: t.colors.working, false: t.colors.surface3 }}
            />
            <Text style={styles.checkLabel}>
              auto-approve tools{' '}
              <Text style={styles.hint}>--dangerously-skip-permissions</Text>
            </Text>
          </View>
        )}

        <Text style={styles.sec}>extra args</Text>
        <TextInput
          style={[styles.input, styles.mono]}
          value={argsText}
          onChangeText={setArgsText}
          placeholder="optional — e.g. --resume <id>"
          placeholderTextColor={t.colors.sub}
          autoCapitalize="none"
          autoCorrect={false}
        />

        {!!error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      <View style={styles.foot}>
        <Pressable style={styles.btnGhost} onPress={onClose} disabled={busy}>
          <Text style={styles.btnGhostText}>cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.btnPrimary, (busy || !kind) && styles.btnDisabled]}
          disabled={busy || !kind}
          onPress={submit}
        >
          {busy ? (
            <ActivityIndicator color={t.colors.accentInk} />
          ) : (
            <Text style={styles.btnPrimaryText}>start {kind || 'chat'}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
  root: { flex: 1, backgroundColor: t.colors.bg },
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
  scrollContent: { padding: 14, paddingBottom: 40, gap: 6 },
  sec: {
    color: t.cyber ? t.colors.red : t.colors.sub,
    fontSize: 11,
    ...t.font('ui', '700'),
    textTransform: 'uppercase',
    ...t.hud,
    opacity: t.cyber ? 0.85 : 1,
    marginTop: 14,
    marginBottom: 4,
  },
  note: { ...t.font('ui'), color: t.colors.sub, fontSize: 13, paddingVertical: 6 },
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
  destLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 },
  destLabel: { color: t.colors.text, fontSize: 14, ...t.font('ui', '600'), flex: 1 },
  destLabelOn: { color: t.colors.accent, ...t.glow(t.colors.accent, 6) },
  destExtra: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.sub, fontSize: 11, maxWidth: '40%' },
  subs: { paddingLeft: 12, marginBottom: 4 },
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
  kindChip: {
    backgroundColor: t.cyber ? 'transparent' : t.colors.surface,
    borderRadius: t.radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: t.cyber ? alpha(t.colors.accent, 0.3) : t.colors.hairline,
  },
  kindOn: t.cyber
    ? { borderColor: t.colors.accent, backgroundColor: alpha(t.colors.accent, 0.16), ...t.boxGlow(t.colors.accent, 14) }
    : { borderColor: t.colors.accent, backgroundColor: t.colors.surface2 },
  kindOff: { opacity: 0.4 },
  kindText: { color: t.colors.text, ...t.font('ui', '600'), ...t.hud, fontSize: t.cyber ? 12 : undefined },
  kindTextOn: { color: t.colors.accent, ...t.glow(t.colors.accent, 8) },
  kindTextOff: { color: t.colors.sub },
  hint: { ...t.font('ui'), color: t.colors.sub, fontSize: 12, marginTop: 4 },
  mono: { ...t.font('mono'), },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  checkLabel: { ...t.font('ui'), color: t.colors.text, flex: 1, fontSize: 14 },
  error: {
    ...t.font(t.cyber ? 'mono' : 'ui'),
    color: t.cyber ? t.colors.red : t.colors.blocked,
    marginTop: 12,
    backgroundColor: alpha(t.cyber ? t.colors.red : t.colors.blocked, 0.12),
    borderWidth: t.cyber ? 1 : 0,
    borderColor: alpha(t.colors.red, 0.3),
    padding: 10,
    borderRadius: t.radius.sm,
  },
  foot: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.colors.hairline,
    backgroundColor: t.cyber ? alpha(t.colors.bg, 0.84) : t.colors.surface,
  },
  btnGhost: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: t.radius.md,
    backgroundColor: t.cyber ? 'transparent' : t.colors.surface2,
    borderWidth: t.cyber ? 1 : 0,
    borderColor: alpha(t.colors.accent, 0.3),
  },
  btnGhostText: { color: t.colors.text, ...t.font('ui', '600'), ...t.hud },
  btnPrimary: {
    flex: 2,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: t.radius.md,
    backgroundColor: t.cyber ? t.colors.hot : t.colors.accent,
    ...t.boxGlow(t.colors.hot, 16, 0.5),
  },
  btnPrimaryText: { color: t.cyber ? '#000000' : t.colors.accentInk, ...t.font('ui', '700'), fontSize: t.cyber ? 14 : 16, ...t.hud },
  btnDisabled: { opacity: 0.45 },
});

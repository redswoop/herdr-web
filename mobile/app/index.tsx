import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  GROUP_MODES,
  STATUS_WORD,
  buildGroups,
  chipName,
  getPlatform,
  lastKind,
  spawnChat,
  type Agent,
  type Group,
  type GroupBy,
  type SpawnTarget,
} from '@herdr/shared';
import { useRoster } from '../src/roster';
import { Icon } from '../src/components/Icon';
import { Overview } from '../src/components/Overview';
import { alpha, useStyles, useTheme, type Tokens } from '../src/theme';

const GROUPBY_KEY = 'herdr.groupBy';
const CLOSED_KEY = 'herdr.groupsClosed';
const HOME_VIEW_KEY = 'herdr.homeView';

function loadGroupBy(): GroupBy {
  const v = getPlatform().kv.get(GROUPBY_KEY);
  return GROUP_MODES.some((m) => m.key === v) ? (v as GroupBy) : 'recent';
}

function loadClosed(): Set<string> {
  try {
    const j = JSON.parse(getPlatform().kv.get(CLOSED_KEY) ?? '[]');
    return new Set(Array.isArray(j) ? j.filter((x: unknown) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function loadHomeView(): 'list' | 'cards' {
  return getPlatform().kv.get(HOME_VIEW_KEY) === 'cards' ? 'cards' : 'list';
}

export default function RosterScreen() {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const { roster, connected, authNeeded } = useRoster();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [groupBy, setGroupBy] = useState<GroupBy>(loadGroupBy);
  const [closed, setClosed] = useState<Set<string>>(loadClosed);
  const [homeView, setHomeView] = useState<'list' | 'cards'>(loadHomeView);
  const [spawning, setSpawning] = useState<string | null>(null);

  const groups = useMemo(
    () =>
      buildGroups(roster.agents, roster.workspaces ?? [], roster.tabs ?? [], groupBy),
    [roster, groupBy],
  );

  type Row =
    | { type: 'tab'; key: string; title: string; focused: boolean }
    | { type: 'agent'; key: string; agent: Agent };

  // a stored key flips the group's default: open groups close, and a
  // defaultClosed group (recent mode's stale fold) opens
  const isClosed = useCallback(
    (g: Pick<Group, 'key' | 'defaultClosed'>) =>
      closed.has(`${groupBy}:${g.key}`) !== !!g.defaultClosed,
    [closed, groupBy],
  );

  const sections = useMemo(
    () =>
      groups.map((g) => {
        const collapsed = isClosed(g);
        let data: Row[] = [];
        if (!collapsed) {
          if (g.subs?.length) {
            data = g.subs.flatMap((s) => [
              {
                type: 'tab' as const,
                key: `tab:${s.key}`,
                title: s.title,
                focused: !!s.focused,
              },
              ...s.agents.map((a) => ({ type: 'agent' as const, key: a.paneId, agent: a })),
            ]);
          } else {
            data = g.agents.map((a) => ({ type: 'agent' as const, key: a.paneId, agent: a }));
          }
        }
        return { title: g.title, key: g.key, group: g, data };
      }),
    [groups, isClosed],
  );

  const pickGroupBy = (mode: GroupBy) => {
    setGroupBy(mode);
    getPlatform().kv.set(GROUPBY_KEY, mode);
  };

  const pickHomeView = (v: 'list' | 'cards') => {
    setHomeView(v);
    getPlatform().kv.set(HOME_VIEW_KEY, v);
  };

  const toggle = useCallback((gKey: string) => {
    const key = `${groupBy}:${gKey}`;
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      // cap so stale group keys can't accumulate forever
      getPlatform().kv.set(CLOSED_KEY, JSON.stringify([...next].slice(-100)));
      return next;
    });
  }, [groupBy]);

  const openNew = (target?: SpawnTarget) => {
    router.push({
      pathname: '/new-chat',
      params: {
        ...(target?.workspaceId ? { workspaceId: target.workspaceId } : {}),
        ...(target?.cwd ? { cwd: target.cwd } : {}),
      },
    });
  };

  const quickChat = async (key: string, target: SpawnTarget) => {
    if (spawning) return;
    setSpawning(key);
    try {
      const paneId = await spawnChat({ kind: lastKind(), ...target });
      router.push(`/agent/${encodeURIComponent(paneId)}`);
    } catch (e) {
      getPlatform().notifyError(String((e as Error).message ?? e));
    } finally {
      setSpawning(null);
    }
  };

  if (authNeeded || !roster.updatedAt) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Image
          source={require('../assets/brand/empty-sheep.png')}
          style={styles.gateArt}
          accessibilityLabel="Capra"
        />
        <Text style={styles.gateTitle}>
          {authNeeded ? 'this herd is fenced' : 'connect to herdr'}
        </Text>
        <Text style={styles.gateSub}>
          {authNeeded
            ? 'paste the access token in settings'
            : 'set the server URL (and token) in settings'}
        </Text>
        <Link href="/settings" asChild>
          <Pressable style={styles.primaryBtn}>
            <Icon name="settings" size={18} color={t.colors.accentInk} />
            <Text style={styles.primaryBtnText}>open settings</Text>
          </Pressable>
        </Link>
      </View>
    );
  }

  const blockedCount = roster.agents.filter((a) => a.status === 'blocked').length;

  return (
    <View style={styles.root}>
      {!connected && roster.updatedAt > 0 && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>connection lost — reconnecting…</Text>
        </View>
      )}
      <View style={styles.toolbar}>
        <View style={styles.connRow}>
          <View style={[styles.dot, connected && styles.dotOk]} />
          <Text style={styles.connLabel}>{connected ? 'connected' : 'offline'}</Text>
          {blockedCount > 0 && (
            <View style={styles.blockedBadge}>
              <Text style={styles.blockedBadgeText}>{blockedCount} blocked</Text>
            </View>
          )}
        </View>
        <Link href="/settings" asChild>
          <Pressable hitSlop={12} style={styles.settingsBtn} accessibilityLabel="settings">
            <Icon name="settings" size={20} color={t.colors.accent} />
          </Pressable>
        </Link>
      </View>

      <View style={styles.modeRow}>
        <Pressable
          style={[styles.modeChip, homeView === 'list' && styles.modeOn]}
          onPress={() => pickHomeView('list')}
          accessibilityLabel="list view"
        >
          <Icon
            name="list"
            size={15}
            color={homeView === 'list' ? t.colors.accentInk : t.colors.sub}
          />
          <Text style={[styles.modeText, homeView === 'list' && styles.modeTextOn]}>list</Text>
        </Pressable>
        <Pressable
          style={[styles.modeChip, homeView === 'cards' && styles.modeOn]}
          onPress={() => pickHomeView('cards')}
          accessibilityLabel="cards view"
        >
          <Icon
            name="grid"
            size={15}
            color={homeView === 'cards' ? t.colors.accentInk : t.colors.sub}
          />
          <Text style={[styles.modeText, homeView === 'cards' && styles.modeTextOn]}>cards</Text>
        </Pressable>
        {homeView === 'list' &&
          GROUP_MODES.map((m) => (
            <Pressable
              key={m.key}
              style={[styles.modeChip, groupBy === m.key && styles.modeOn]}
              onPress={() => pickGroupBy(m.key)}
            >
              <Text style={[styles.modeText, groupBy === m.key && styles.modeTextOn]}>
                {m.label}
              </Text>
            </Pressable>
          ))}
      </View>

      {homeView === 'cards' ? (
        <Overview
          roster={roster}
          onSelect={(paneId) => router.push(`/agent/${encodeURIComponent(paneId)}`)}
          onNewChat={openNew}
          onQuickChat={async (target) => {
            const paneId = await spawnChat({ kind: lastKind(), ...target });
            router.push(`/agent/${encodeURIComponent(paneId)}`);
          }}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(row) => row.key}
          stickySectionHeadersEnabled
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Image
                source={require('../assets/brand/empty-sheep.png')}
                style={styles.emptyArt}
                accessibilityLabel="Capra"
              />
              <Text style={styles.empty}>
                {roster.herdrDown ? 'herdr server unreachable' : 'no agents detected'}
              </Text>
              {!roster.herdrDown && (
                <Pressable style={styles.primaryBtn} onPress={() => openNew()}>
                  <Icon name="plus" size={18} color={t.colors.accentInk} />
                  <Text style={styles.primaryBtnText}>start a chat</Text>
                </Pressable>
              )}
            </View>
          }
          renderSectionHeader={({ section }) => {
            const g = section.group as Group;
            if (g.flat) return null; // recent mode's main list has no header
            const collapsed = isClosed(g);
            const blockedInGroup = g.agents.filter((a) => a.status === 'blocked').length;
            return (
              <View style={styles.sectionHead}>
                <Pressable style={styles.sectionMain} onPress={() => toggle(g.key)}>
                  <Icon
                    name={collapsed ? 'chevron-right' : 'chevron-down'}
                    size={16}
                    color={t.colors.sub}
                  />
                  <Text style={styles.sectionTitle} numberOfLines={1}>
                    {t.cyber && <Text style={styles.slash}>{'// '}</Text>}
                    {g.title}
                  </Text>
                  {!!g.badge && <Text style={styles.badge}>{g.badge}</Text>}
                  {!!g.focused && <Icon name="focus" size={14} color={t.colors.accent} />}
                  {!!g.status && (
                    <View style={[styles.dot, { backgroundColor: t.status(g.status) }, t.boxGlow(t.status(g.status), 9)]} />
                  )}
                  <Text style={styles.groupCount}>
                    {blockedInGroup > 0 ? `${blockedInGroup}·` : ''}
                    {g.agents.length}
                  </Text>
                </Pressable>
                {!!g.spawn && (
                  <Pressable
                    style={styles.quickBtn}
                    onPress={() => quickChat(g.key, g.spawn!)}
                    onLongPress={() => openNew(g.spawn)}
                    disabled={!!spawning}
                    hitSlop={8}
                    accessibilityLabel="new session here (long-press to customize)"
                  >
                    {spawning === g.key ? (
                      <ActivityIndicator size="small" color={t.colors.accent} />
                    ) : (
                      <Icon name="plus" size={18} color={t.colors.accent} />
                    )}
                  </Pressable>
                )}
              </View>
            );
          }}
          renderItem={({ item }) => {
            if (item.type === 'tab') {
              return (
                <View style={styles.tabHead}>
                  <Text style={styles.tabTitle}>{item.title}</Text>
                  {item.focused && <Icon name="focus" size={14} color={t.colors.accent} />}
                </View>
              );
            }
            const a = item.agent;
            const labels = Object.entries(a.stateLabels ?? {});
            const showAgent = groupBy !== 'agent';
            const basename = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;
            return (
              <Pressable
                style={[styles.row, a.status === 'blocked' && styles.rowBlocked]}
                onPress={() => router.push(`/agent/${encodeURIComponent(a.paneId)}`)}
              >
                <View style={[styles.statusDot, { backgroundColor: t.status(a.status) }, t.boxGlow(t.status(a.status), 10)]} />
                <View style={styles.rowBody}>
                  <View style={styles.rowTitleRow}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {chipName(a)}
                    </Text>
                    {a.focused ? <Icon name="focus" size={13} color={t.colors.accent} /> : null}
                  </View>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {[
                      showAgent ? a.displayAgent ?? a.agent ?? '?' : null,
                      a.cwd ? basename(a.cwd) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  {(labels.length > 0 ||
                    !a.hasTranscript ||
                    (a.launchPending && a.status === 'unknown')) && (
                    <View style={styles.tags}>
                      {a.launchPending && a.status === 'unknown' && (
                        <Text style={[styles.tag, styles.tagWarn]}>starting…</Text>
                      )}
                      {!a.hasTranscript && a.status !== 'unknown' && (
                        <Text style={styles.tag}>fresh</Text>
                      )}
                      {labels.map(([k, v]) => (
                        <Text key={k} style={styles.tag}>
                          {v}
                        </Text>
                      ))}
                    </View>
                  )}
                </View>
                <Text style={[styles.stateWord, { color: t.status(a.status) }, t.glow(t.status(a.status), 6)]}>
                  {STATUS_WORD[a.status] ?? a.status}
                </Text>
              </Pressable>
            );
          }}
        />
      )}

      <Pressable
        style={[styles.fab, { bottom: Math.max(insets.bottom, 12) + 8 }]}
        onPress={() => openNew()}
        accessibilityLabel="new chat"
      >
        <Icon name="plus" size={28} color={t.colors.accentInk} />
      </Pressable>
    </View>
  );
}

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
  root: { flex: 1, backgroundColor: t.colors.bg },
  center: {
    flex: 1,
    backgroundColor: t.colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 10,
  },
  gateArt: { width: 180, height: 180, marginBottom: 4 },
  emptyArt: { width: 140, height: 140, opacity: 0.95 },
  gateTitle: { color: t.colors.text, fontSize: 20, ...t.font('ui', '700') },
  gateSub: { ...t.font('ui'), color: t.colors.sub, textAlign: 'center', marginBottom: 12 },
  primaryBtn: {
    backgroundColor: t.colors.hot,
    ...t.boxGlow(t.colors.hot),
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: t.radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  primaryBtnText: { color: t.colors.accentInk, ...t.font('ui', '700') },
  banner: { backgroundColor: t.colors.working, padding: 8 },
  bannerText: {
    color: t.colors.accentInk,
    textAlign: 'center',
    fontSize: 13,
    ...t.font('ui', '600'),
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.hairline,
    backgroundColor: t.glass,
  },
  connRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: {
    ...t.dot(8),
    backgroundColor: t.cyber ? t.colors.red : t.colors.sub,
    ...t.boxGlow(t.colors.red, 10),
  },
  dotOk: { backgroundColor: t.colors.done, ...t.boxGlow(t.colors.done, 9) },
  connLabel: { ...t.font('ui'), ...t.hud, color: t.colors.sub, fontSize: t.cyber ? 12 : 13 },
  blockedBadge: {
    backgroundColor: alpha(t.colors.blocked, t.cyber ? 0.14 : 0.25),
    borderWidth: t.cyber ? 1 : 0,
    borderColor: alpha(t.colors.blocked, 0.5),
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: t.r(999),
  },
  blockedBadgeText: { color: t.colors.blocked, fontSize: t.cyber ? 11 : 12, ...t.font('ui', '700'), ...t.hud, ...t.glow(t.colors.blocked, 6) },
  settingsBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: t.glass,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.hairline,
  },
  modeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: t.r(999),
    backgroundColor: t.cyber ? 'transparent' : t.colors.surface2,
    borderWidth: t.cyber ? 1 : 0,
    borderColor: alpha(t.colors.accent, 0.3),
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  modeOn: t.cyber
    ? { backgroundColor: alpha(t.colors.accent, 0.16), borderColor: t.colors.accent, ...t.boxGlow(t.colors.accent, 14) }
    : { backgroundColor: t.colors.accent },
  modeText: { color: t.colors.sub, fontSize: t.cyber ? 11 : 12, ...t.font('ui', '600'), ...t.hud },
  modeTextOn: t.cyber ? { color: t.colors.accent, ...t.glow(t.colors.accent, 8) } : { color: t.colors.accentInk },
  list: { paddingBottom: 100 },
  emptyBox: { alignItems: 'center', marginTop: 32, gap: 12, paddingHorizontal: 24 },
  empty: { ...t.font('ui'), color: t.colors.sub, textAlign: 'center' },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: t.glass,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.hairline,
  },
  sectionMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { color: t.colors.text, ...t.font('ui', '700'), fontSize: 13, flex: 1, ...(t.cyber ? { ...t.font('mono'), letterSpacing: 1.6 } : {}) },
  slash: { color: t.colors.red, opacity: 0.75 },
  badge: { ...t.font('ui'), ...t.hud, color: t.colors.sub, fontSize: 11 },
  groupCount: { ...t.font('ui'), ...t.hud, color: t.colors.sub, fontSize: 11, fontVariant: ['tabular-nums'] },
  tabHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 2,
    backgroundColor: t.canvas,
  },
  tabTitle: { color: t.colors.sub, fontSize: 11, ...t.font('ui', '700'), textTransform: 'uppercase', ...t.hud },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  tag: {
    color: t.colors.sub,
    ...t.font(t.cyber ? 'mono' : 'ui'),
    fontSize: 10,
    backgroundColor: t.glass2,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: t.r(4),
    overflow: 'hidden',
  },
  tagWarn: { color: t.colors.working },
  stateWord: { fontSize: 11, ...t.font('ui', '700'), textTransform: 'lowercase', ...t.hud },
  quickBtn: {
    width: 32,
    height: 32,
    borderRadius: t.r(16),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.cyber ? 'transparent' : t.colors.surface2,
    borderWidth: t.cyber ? 1 : 0,
    borderColor: alpha(t.colors.accent, 0.3),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.hairline,
    borderLeftWidth: t.cyber ? 2 : 0,
    borderLeftColor: 'transparent',
  },
  rowBlocked: { backgroundColor: alpha(t.colors.blocked, 0.1), borderLeftColor: t.colors.blocked },
  statusDot: t.dot(10),
  rowBody: { flex: 1, minWidth: 0 },
  rowTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: { color: t.colors.text, fontSize: 15, ...t.font('ui', '600'), flexShrink: 1, ...t.phosphor },
  rowSub: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.sub, fontSize: 12, marginTop: 2 },
  blockedChip: {
    backgroundColor: t.colors.blocked,
    ...t.boxGlow(t.colors.blocked, 10),
    width: 22,
    height: 22,
    borderRadius: t.r(11),
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockedChipText: { color: t.colors.accentInk, ...t.font('ui', '700') },
  fab: {
    position: 'absolute',
    right: 18,
    width: 56,
    height: 56,
    borderRadius: t.r(28),
    backgroundColor: t.cyber ? t.colors.hot : t.colors.accent,
    ...t.boxGlow(t.colors.hot, 16, 0.6),
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
});

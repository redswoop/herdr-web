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
  useRoster,
  type Agent,
  type Group,
  type GroupBy,
  type SpawnTarget,
} from '@herdr/shared';
import { Icon } from '../src/components/Icon';
import { Overview } from '../src/components/Overview';
import { colors, radius, statusColor } from '../src/theme';

const GROUPBY_KEY = 'herdr.groupBy';
const CLOSED_KEY = 'herdr.groupsClosed';
const HOME_VIEW_KEY = 'herdr.homeView';

function loadGroupBy(): GroupBy {
  const v = getPlatform().kv.get(GROUPBY_KEY);
  return v === 'status' || v === 'project' || v === 'agent' ? v : 'workspace';
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

  const closedKey = (gKey: string) => `${groupBy}:${gKey}`;

  const sections = useMemo(
    () =>
      groups.map((g) => {
        const collapsed = closed.has(closedKey(g.key));
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
    [groups, closed, groupBy],
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
            <Icon name="settings" size={18} color={colors.accentInk} />
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
            <Icon name="settings" size={20} color={colors.accent} />
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
            color={homeView === 'list' ? colors.accentInk : colors.sub}
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
            color={homeView === 'cards' ? colors.accentInk : colors.sub}
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
                  <Icon name="plus" size={18} color={colors.accentInk} />
                  <Text style={styles.primaryBtnText}>start a chat</Text>
                </Pressable>
              )}
            </View>
          }
          renderSectionHeader={({ section }) => {
            const g = section.group as Group;
            const collapsed = closed.has(`${groupBy}:${g.key}`);
            const blockedInGroup = g.agents.filter((a) => a.status === 'blocked').length;
            return (
              <View style={styles.sectionHead}>
                <Pressable style={styles.sectionMain} onPress={() => toggle(g.key)}>
                  <Icon
                    name={collapsed ? 'chevron-right' : 'chevron-down'}
                    size={16}
                    color={colors.sub}
                  />
                  <Text style={styles.sectionTitle}>{g.title}</Text>
                  {!!g.badge && <Text style={styles.badge}>{g.badge}</Text>}
                  {!!g.focused && <Icon name="focus" size={14} color={colors.accent} />}
                  {!!g.status && (
                    <View style={[styles.dot, { backgroundColor: statusColor(g.status) }]} />
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
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <Icon name="plus" size={18} color={colors.accent} />
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
                  {item.focused && <Icon name="focus" size={14} color={colors.accent} />}
                </View>
              );
            }
            const a = item.agent;
            const labels = Object.entries(a.stateLabels ?? {});
            const showAgent = groupBy !== 'agent';
            const basename = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;
            return (
              <Pressable
                style={styles.row}
                onPress={() => router.push(`/agent/${encodeURIComponent(a.paneId)}`)}
              >
                <View style={[styles.statusDot, { backgroundColor: statusColor(a.status) }]} />
                <View style={styles.rowBody}>
                  <View style={styles.rowTitleRow}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {chipName(a)}
                    </Text>
                    {a.focused ? <Icon name="focus" size={13} color={colors.accent} /> : null}
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
                <Text style={[styles.stateWord, { color: statusColor(a.status) }]}>
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
        <Icon name="plus" size={28} color={colors.accentInk} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 10,
  },
  gateArt: { width: 180, height: 180, marginBottom: 4 },
  emptyArt: { width: 140, height: 140, opacity: 0.95 },
  gateTitle: { color: colors.text, fontSize: 20, fontWeight: '700' },
  gateSub: { color: colors.sub, textAlign: 'center', marginBottom: 12 },
  primaryBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  primaryBtnText: { color: colors.accentInk, fontWeight: '700' },
  banner: { backgroundColor: colors.working, padding: 8 },
  bannerText: {
    color: colors.accentInk,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  connRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.sub,
  },
  dotOk: { backgroundColor: colors.done },
  connLabel: { color: colors.sub, fontSize: 13 },
  blockedBadge: {
    backgroundColor: 'rgba(247,118,142,0.25)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  blockedBadgeText: { color: colors.blocked, fontSize: 12, fontWeight: '700' },
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
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  modeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  modeOn: { backgroundColor: colors.accent },
  modeText: { color: colors.sub, fontSize: 12, fontWeight: '600' },
  modeTextOn: { color: colors.accentInk },
  list: { paddingBottom: 100 },
  emptyBox: { alignItems: 'center', marginTop: 32, gap: 12, paddingHorizontal: 24 },
  empty: { color: colors.sub, textAlign: 'center' },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  sectionMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 },
  badge: { color: colors.sub, fontSize: 11 },
  groupCount: { color: colors.sub, fontSize: 11, fontVariant: ['tabular-nums'] },
  tabHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 2,
    backgroundColor: colors.bg,
  },
  tabTitle: { color: colors.sub, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  tag: {
    color: colors.sub,
    fontSize: 10,
    backgroundColor: colors.surface2,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  tagWarn: { color: colors.working },
  stateWord: { fontSize: 11, fontWeight: '700', textTransform: 'lowercase' },
  quickBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  rowSub: { color: colors.sub, fontSize: 12, marginTop: 2 },
  blockedChip: {
    backgroundColor: colors.blocked,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockedChipText: { color: colors.accentInk, fontWeight: '800' },
  fab: {
    position: 'absolute',
    right: 18,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
});

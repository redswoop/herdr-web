import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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

  const sections = useMemo(
    () =>
      groups.map((g) => ({
        title: g.title,
        key: g.key,
        group: g,
        data: closed.has(g.key) ? ([] as Agent[]) : g.subs ? g.subs.flatMap((s) => s.agents) : g.agents,
      })),
    [groups, closed],
  );

  const pickGroupBy = (mode: GroupBy) => {
    setGroupBy(mode);
    getPlatform().kv.set(GROUPBY_KEY, mode);
  };

  const pickHomeView = (v: 'list' | 'cards') => {
    setHomeView(v);
    getPlatform().kv.set(HOME_VIEW_KEY, v);
  };

  const toggle = useCallback((key: string) => {
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      getPlatform().kv.set(CLOSED_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

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
        <Text style={styles.emoji}>🔒</Text>
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
          <Pressable hitSlop={12}>
            <Text style={styles.settingsLink}>settings</Text>
          </Pressable>
        </Link>
      </View>

      <View style={styles.modeRow}>
        <Pressable
          style={[styles.modeChip, homeView === 'list' && styles.modeOn]}
          onPress={() => pickHomeView('list')}
        >
          <Text style={[styles.modeText, homeView === 'list' && styles.modeTextOn]}>list</Text>
        </Pressable>
        <Pressable
          style={[styles.modeChip, homeView === 'cards' && styles.modeOn]}
          onPress={() => pickHomeView('cards')}
        >
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
          keyExtractor={(a) => a.paneId}
          stickySectionHeadersEnabled
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.empty}>no agents yet</Text>
              <Pressable style={styles.primaryBtn} onPress={() => openNew()}>
                <Text style={styles.primaryBtnText}>start a chat</Text>
              </Pressable>
            </View>
          }
          renderSectionHeader={({ section }) => {
            const g = section.group as Group;
            const collapsed = closed.has(g.key);
            return (
              <View style={styles.sectionHead}>
                <Pressable style={styles.sectionMain} onPress={() => toggle(g.key)}>
                  <Text style={styles.sectionTitle}>
                    {collapsed ? '▸' : '▾'} {g.title}
                  </Text>
                  {!!g.badge && <Text style={styles.badge}>{g.badge}</Text>}
                  {!!g.status && (
                    <View style={[styles.dot, { backgroundColor: statusColor(g.status) }]} />
                  )}
                </Pressable>
                {!!g.spawn && (
                  <Pressable
                    style={styles.quickBtn}
                    onPress={() => quickChat(g.key, g.spawn!)}
                    disabled={!!spawning}
                    hitSlop={8}
                  >
                    {spawning === g.key ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <Text style={styles.quickText}>＋</Text>
                    )}
                  </Pressable>
                )}
              </View>
            );
          }}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => router.push(`/agent/${encodeURIComponent(item.paneId)}`)}
            >
              <View style={[styles.statusDot, { backgroundColor: statusColor(item.status) }]} />
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {chipName(item)}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {STATUS_WORD[item.status] ?? item.status}
                  {item.cwd ? ` · ${item.cwd.split('/').slice(-2).join('/')}` : ''}
                </Text>
              </View>
              {item.status === 'blocked' && (
                <View style={styles.blockedChip}>
                  <Text style={styles.blockedChipText}>!</Text>
                </View>
              )}
            </Pressable>
          )}
        />
      )}

      <Pressable
        style={[styles.fab, { bottom: Math.max(insets.bottom, 12) + 8 }]}
        onPress={() => openNew()}
        accessibilityLabel="new chat"
      >
        <Text style={styles.fabText}>＋</Text>
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
  emoji: { fontSize: 40 },
  gateTitle: { color: colors.text, fontSize: 20, fontWeight: '700' },
  gateSub: { color: colors.sub, textAlign: 'center', marginBottom: 12 },
  primaryBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: radius.md,
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
  settingsLink: { color: colors.accent, fontSize: 14 },
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
  },
  modeOn: { backgroundColor: colors.accent },
  modeText: { color: colors.sub, fontSize: 12, fontWeight: '600' },
  modeTextOn: { color: colors.accentInk },
  list: { paddingBottom: 100 },
  emptyBox: { alignItems: 'center', marginTop: 48, gap: 16 },
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
  quickBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  quickText: { color: colors.accent, fontSize: 18, fontWeight: '600', marginTop: -1 },
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
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
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
  fabText: { color: colors.accentInk, fontSize: 28, fontWeight: '500', marginTop: -2 },
});

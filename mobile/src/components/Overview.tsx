import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  STATUS_WORD,
  chipName,
  get,
  getPlatform,
  type Agent,
  type Project,
  type Roster,
  type SpawnTarget,
} from '@herdr/shared';
import { colors, radius, statusColor } from '../theme';

const STATUS_ORDER: Record<string, number> = {
  blocked: 0,
  working: 1,
  idle: 2,
  unknown: 3,
  done: 4,
};

const basename = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;
const shortPath = (p: string) => p.replace(/^\/home\/[^/]+/, '~');

interface Card {
  key: string;
  title: string;
  path: string | null;
  repo: boolean;
  agents: Agent[];
  spawn?: SpawnTarget;
}

function buildCards(roster: Roster): Card[] {
  const cards = new Map<string, Card>();
  for (const a of roster.agents) {
    const key = a.repoRoot ?? a.cwd ?? 'nowhere';
    const c = cards.get(key) ?? {
      key,
      title: key === 'nowhere' ? 'no project' : basename(key),
      path: key === 'nowhere' ? null : key,
      repo: a.repoRoot === key,
      agents: [],
    };
    c.agents.push(a);
    cards.set(key, c);
  }
  for (const c of cards.values()) {
    c.agents.sort(
      (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
    );
    if (c.path) {
      const counts = new Map<string, number>();
      for (const a of c.agents) counts.set(a.workspaceId, (counts.get(a.workspaceId) ?? 0) + 1);
      const top = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
      c.spawn = { cwd: c.path, workspaceId: top };
    }
  }
  return [...cards.values()].sort(
    (a, b) =>
      (STATUS_ORDER[a.agents[0]?.status] ?? 9) - (STATUS_ORDER[b.agents[0]?.status] ?? 9) ||
      b.agents.length - a.agents.length ||
      a.title.localeCompare(b.title),
  );
}

export function Overview({
  roster,
  onSelect,
  onNewChat,
  onQuickChat,
}: {
  roster: Roster;
  onSelect: (paneId: string) => void;
  onNewChat: (target?: SpawnTarget) => void;
  onQuickChat: (target: SpawnTarget) => Promise<void>;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [spawning, setSpawning] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    get('/api/projects')
      .then((r) => r.json())
      .then((j: { projects: Project[] }) => alive && setProjects(j.projects))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [roster.agents.length]);

  const cards = useMemo(() => buildCards(roster), [roster]);
  const dormant = useMemo(
    () => projects.filter((p) => p.live === 0).slice(0, 12),
    [projects],
  );

  const blocked = roster.agents.filter((a) => a.status === 'blocked').length;
  const working = roster.agents.filter((a) => a.status === 'working').length;

  const quick = async (key: string, target: SpawnTarget) => {
    if (spawning) return;
    setSpawning(key);
    try {
      await onQuickChat(target);
    } catch (e) {
      getPlatform().notifyError(String((e as Error).message ?? e));
    } finally {
      setSpawning(null);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.head}>
        <Text style={styles.title}>🐑 the herd</Text>
        <Text style={styles.summary}>
          {roster.herdrDown
            ? 'herdr unreachable'
            : `${roster.agents.length} session${roster.agents.length === 1 ? '' : 's'}` +
              (blocked ? ` · ${blocked} need you` : '') +
              (working ? ` · ${working} working` : '')}
        </Text>
      </View>

      {cards.map((c) => (
        <View key={c.key} style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {c.repo ? '⎇ ' : ''}
              {c.title}
            </Text>
            {!!c.path && (
              <Text style={styles.cardPath} numberOfLines={1}>
                {shortPath(c.path)}
              </Text>
            )}
            {!!c.spawn && (
              <Pressable
                style={styles.cardPlus}
                onPress={() => quick(c.key, c.spawn!)}
                disabled={!!spawning}
              >
                {spawning === c.key ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Text style={styles.cardPlusText}>＋</Text>
                )}
              </Pressable>
            )}
          </View>
          {c.agents.map((a) => (
            <Pressable key={a.paneId} style={styles.agentRow} onPress={() => onSelect(a.paneId)}>
              <View style={[styles.dot, { backgroundColor: statusColor(a.status) }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.agentName} numberOfLines={1}>
                  {chipName(a)}
                </Text>
                <Text style={styles.agentSub}>{STATUS_WORD[a.status] ?? a.status}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ))}

      {dormant.length > 0 && (
        <>
          <Text style={styles.sec}>recent projects</Text>
          {dormant.map((p) => (
            <Pressable
              key={p.key}
              style={styles.dormant}
              onPress={() => onNewChat({ cwd: p.path })}
            >
              <Text style={styles.dormantName} numberOfLines={1}>
                {p.repo ? '⎇ ' : ''}
                {p.name}
              </Text>
              <Text style={styles.dormantPath} numberOfLines={1}>
                {shortPath(p.path)}
              </Text>
            </Pressable>
          ))}
        </>
      )}

      {!cards.length && !dormant.length && (
        <Text style={styles.empty}>no projects yet — start a chat</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 14, paddingBottom: 100, gap: 10 },
  head: { marginBottom: 6 },
  title: { color: colors.text, fontSize: 22, fontWeight: '700' },
  summary: { color: colors.sub, fontSize: 13, marginTop: 4 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  cardTitle: { color: colors.text, fontWeight: '700', fontSize: 15, flex: 1 },
  cardPath: { color: colors.sub, fontSize: 11, maxWidth: '35%' },
  cardPlus: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardPlusText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  agentName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  agentSub: { color: colors.sub, fontSize: 11 },
  sec: {
    color: colors.sub,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: 12,
  },
  dormant: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  dormantName: { color: colors.text, fontWeight: '600' },
  dormantPath: { color: colors.sub, fontSize: 11, marginTop: 2 },
  empty: { color: colors.sub, textAlign: 'center', marginTop: 40 },
});

import { useMemo } from 'react';
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  STATUS_WORD,
  byAttention,
  byGroupRank,
  chipName,
  getServers,
  hostColor,
  hostName,
  hostOf,
  type Agent,
  type Roster,
  type SpawnTarget,
} from '@herdr/shared';
import { Brackets } from '../cyber';
import { AlarmSweep, RailPacket, Scramble, StatusDot } from '../cyber-fx';
import { alpha, useStyles, useTheme, type Tokens } from '../theme';
import { Icon } from './Icon';

const basename = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;
const shortPath = (p: string) => p.replace(/^\/(?:home|Users)\/[^/]+/, '~');

interface Card {
  key: string;
  title: string;
  path: string | null;
  repo: boolean;
  /** server id (null = primary); the same path on two boxes is two cards */
  host: string | null;
  agents: Agent[];
  spawn?: SpawnTarget;
}

function buildCards(roster: Roster): Card[] {
  const cards = new Map<string, Card>();
  for (const a of roster.agents) {
    const place = a.repoRoot ?? a.cwd ?? 'nowhere';
    const host = hostOf(a.paneId) ?? a.host ?? null;
    const key = host ? `${place}@${host}` : place;
    const c = cards.get(key) ?? {
      key,
      title: place === 'nowhere' ? 'no project' : basename(place),
      path: place === 'nowhere' ? null : place,
      repo: a.repoRoot === place,
      host,
      agents: [],
    };
    c.agents.push(a);
    cards.set(key, c);
  }
  for (const c of cards.values()) {
    c.agents.sort(byAttention);
    if (c.path) {
      const counts = new Map<string, number>();
      for (const a of c.agents) counts.set(a.workspaceId, (counts.get(a.workspaceId) ?? 0) + 1);
      const top = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
      c.spawn = { cwd: c.path, workspaceId: top, ...(c.host ? { host: c.host } : {}) };
    }
  }
  // what needs me, then what I touched last — the list's order, per card
  return [...cards.values()].sort((a, b) => byGroupRank(a, b) || a.title.localeCompare(b.title));
}

export function Overview({
  roster,
  onSelect,
  onNewChat,
  refreshing,
  onRefresh,
}: {
  roster: Roster;
  onSelect: (paneId: string) => void;
  onNewChat: (target?: SpawnTarget) => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const t = useTheme();
  const styles = useStyles(makeStyles);

  const cards = useMemo(() => buildCards(roster), [roster]);
  const multiHost = getServers().length > 1;

  const blocked = roster.agents.filter((a) => a.status === 'blocked').length;
  const working = roster.agents.filter((a) => a.status === 'working').length;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.accent} />}
    >
      <View style={styles.head}>
        <View style={styles.titleRow}>
          <Image
            source={require('../../assets/brand/sheep-mark.png')}
            style={styles.mark}
            accessibilityLabel="Capra"
          />
          <Text style={styles.title}>the herd</Text>
        </View>
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
          <Brackets />
          {multiHost && <View style={[styles.hostStripe, { backgroundColor: hostColor(c.host) }]} />}
          <View style={styles.cardHead}>
            <View style={styles.cardTitleRow}>
              {c.repo ? (
                <Icon name="folder" size={14} color={t.colors.accent} />
              ) : null}
              <Scramble style={styles.cardTitle} numberOfLines={1}>
                {c.title}
              </Scramble>
              {multiHost && (
                <Text style={[styles.hostChip, { color: hostColor(c.host) }]} numberOfLines={1}>
                  {hostName(c.host)}
                </Text>
              )}
            </View>
            {!!c.path && (
              <Text style={styles.cardPath} numberOfLines={1}>
                {shortPath(c.path)}
              </Text>
            )}
            {!!c.spawn && (
              <Pressable style={styles.cardPlus} onPress={() => onNewChat(c.spawn)} accessibilityLabel="new session here">
                <Icon name="plus" size={18} color={t.colors.accent} />
              </Pressable>
            )}
          </View>
          {c.agents.map((a) => (
            <Pressable key={a.paneId} style={styles.agentRow} onPress={() => onSelect(a.paneId)}>
              <StatusDot status={a.status} size={8} />
              <View style={{ flex: 1 }}>
                <View style={styles.agentNameRow}>
                  <Text style={styles.agentName} numberOfLines={1}>
                    {chipName(a)}
                  </Text>
                  {a.focused ? <Icon name="focus" size={13} color={t.colors.accent} /> : null}
                </View>
                <Text style={styles.agentSub}>
                  {STATUS_WORD[a.status] ?? a.status}
                  {a.displayAgent || a.agent ? ` · ${a.displayAgent ?? a.agent}` : ''}
                </Text>
              </View>
              <RailPacket active={a.status === 'working'} edge="bottom" size={1} color={t.colors.working} period={3000} />
              {a.status === 'blocked' && <AlarmSweep />}
            </Pressable>
          ))}
        </View>
      ))}



      {!cards.length && (
        <Text style={styles.empty}>no projects yet — start a chat</Text>
      )}
    </ScrollView>
  );
}

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 14, paddingBottom: 100, gap: 10 },
  head: { marginBottom: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 36, height: 36, borderRadius: t.r(10) },
  title: t.cyber
    ? { color: t.colors.red, fontSize: t.sz('ui', 18), ...t.font('display', '900'), letterSpacing: 3, textTransform: 'uppercase', ...t.glow(t.colors.red, 12) }
    : { color: t.colors.text, fontSize: t.sz('ui', 22), ...t.font('ui', '700') },
  summary: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.sub, fontSize: t.sz('ui', 13), marginTop: 4 },
  card: {
    backgroundColor: t.cyber ? alpha(t.colors.surface, 0.9) : t.colors.surface,
    borderRadius: t.radius.md,
    padding: 12,
    borderWidth: t.cyber ? 0 : 1,
    borderColor: t.colors.hairline,
    borderTopWidth: 1,
    borderTopColor: t.cyber ? alpha(t.colors.red, 0.55) : t.colors.hairline,
    ...(t.cyber ? { boxShadow: `inset 0 1px 30px -12px ${alpha(t.colors.red, 0.35)}` } : {}),
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  hostStripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, opacity: 0.9, borderTopLeftRadius: t.radius.md, borderBottomLeftRadius: t.radius.md },
  hostChip: { ...t.font(t.cyber ? 'mono' : 'ui', '700'), ...t.hud, fontSize: t.sz('ui', 11), flexShrink: 0 },
  cardTitleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  cardTitle: t.cyber
    ? { color: t.colors.red, ...t.font('display', '700'), fontSize: t.sz('ui', 12), letterSpacing: 1.5, textTransform: 'uppercase', flexShrink: 1 }
    : { color: t.colors.text, ...t.font('ui', '700'), fontSize: t.sz('ui', 15), flexShrink: 1 },
  cardPath: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.sub, fontSize: t.sz('ui', 11), maxWidth: '35%' },
  cardPlus: {
    width: 28,
    height: 28,
    borderRadius: t.r(14),
    backgroundColor: t.cyber ? 'transparent' : t.colors.surface2,
    borderWidth: t.cyber ? 1 : 0,
    borderColor: alpha(t.colors.accent, 0.3),
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.colors.hairline,
    overflow: 'hidden',
  },
  agentName: { color: t.colors.text, fontSize: t.sz('ui', 14), ...t.font('ui', '600'), flexShrink: 1, ...t.phosphor },
  agentSub: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.sub, fontSize: t.sz('ui', 11) },
  sec: {
    color: t.cyber ? t.colors.red : t.colors.sub,
    fontSize: t.sz('ui', 11),
    ...t.font('ui', '700'),
    textTransform: 'uppercase',
    ...t.hud,
    marginTop: 12,
  },
  empty: { ...t.font('ui'), color: t.colors.sub, textAlign: 'center', marginTop: 40 },
});

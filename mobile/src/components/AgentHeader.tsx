/* The agent screen's own header: back, who/where, and the live controls
   (rewind, permission mode, status). Replaces the native stack header, whose
   centred title lost to the back circle and the status chip on a phone. */
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  LIVE_MODE_KINDS,
  MODE_DESC,
  MODE_LABEL,
  MODE_ORDER,
  chipName,
  type Agent,
  type AgentStatus,
  type ModeState,
  type PermissionMode,
} from '@herdr/shared';
import { NeonRail } from '../cyber';
import { alpha, useStyles, useTheme, type Tokens } from '../theme';
import { Icon } from './Icon';

const shortPath = (p: string) => p.replace(/^\/home\/[^/]+/, '~');

export function AgentHeader({
  paneId,
  agent,
  status,
  working,
  mode,
  modeBusy,
  rewindBusy,
  onBack,
  onSetMode,
  onRewind,
}: {
  paneId: string;
  agent: Agent | undefined;
  status: AgentStatus | undefined;
  working: boolean;
  mode: ModeState;
  modeBusy: boolean;
  rewindBusy: boolean;
  onBack: () => void;
  onSetMode: (m: PermissionMode) => Promise<boolean>;
  onRewind: () => void;
}) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [modeOpen, setModeOpen] = useState(false);
  const kind = agent?.agent;
  const liveMode = !!kind && LIVE_MODE_KINDS.includes(kind) && mode !== 'unknown';
  const canRewind = kind === 'claude';
  const blocked = status === 'blocked';
  const sColor = t.status(status);
  const mColor = modeColor(t, mode);

  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        <Pressable onPress={onBack} hitSlop={10} style={styles.back} accessibilityLabel="back">
          <Icon name="back" size={26} color={t.cyber ? t.colors.red : t.colors.text} />
        </Pressable>
        <View style={styles.who}>
          <Text style={styles.title} numberOfLines={1}>
            {agent ? chipName(agent) : paneId}
          </Text>
          {!!agent && (
            <Text style={styles.sub} numberOfLines={1}>
              {[agent.displayAgent ?? agent.agent, agent.cwd ? shortPath(agent.cwd) : null]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          )}
        </View>
        {canRewind && (
          <Pressable
            onPress={onRewind}
            disabled={rewindBusy || working || blocked}
            hitSlop={6}
            style={[styles.ctl, (rewindBusy || working || blocked) && styles.ctlOff]}
            accessibilityLabel="rewind to a checkpoint"
          >
            {rewindBusy ? (
              <ActivityIndicator size="small" color={t.colors.accent} />
            ) : (
              <Icon name="rewind" size={16} color={t.colors.accent} />
            )}
          </Pressable>
        )}
        {liveMode && (
          <Pressable
            onPress={() => setModeOpen(true)}
            disabled={modeBusy}
            hitSlop={6}
            style={[styles.chip, { borderColor: alpha(mColor, 0.55), backgroundColor: alpha(mColor, t.cyber ? 0.1 : 0.18) }, modeBusy && styles.ctlOff]}
            accessibilityLabel="permission mode"
          >
            <Text style={[styles.chipText, { color: mColor }, t.glow(mColor, 6)]}>{MODE_LABEL[mode]}</Text>
          </Pressable>
        )}
        <View style={styles.status}>
          <View style={[t.dot(8), { backgroundColor: sColor }, t.boxGlow(sColor, 10, 0.9)]} />
          <Text style={[styles.statusText, { color: sColor }, t.glow(sColor, 6)]}>{status ?? '—'}</Text>
        </View>
      </View>
      {t.cyber ? <NeonRail /> : <View style={styles.hairline} />}

      <Modal visible={modeOpen} transparent animationType="fade" onRequestClose={() => setModeOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setModeOpen(false)}>
          <View style={[styles.pop, { marginTop: insets.top + 52 }]}>
            <Text style={styles.popHead}>permission mode</Text>
            {MODE_ORDER.map((m) => {
              const c = modeColor(t, m);
              const on = m === mode;
              return (
                <Pressable
                  key={m}
                  style={[styles.popRow, on && { backgroundColor: alpha(c, 0.1) }]}
                  onPress={async () => {
                    setModeOpen(false);
                    if (!on) await onSetMode(m);
                  }}
                >
                  <View style={[styles.popMark, on && { backgroundColor: c }, on && t.boxGlow(c, 8, 0.9)]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.popName, on && { color: c }, on && t.glow(c, 6)]}>{MODE_LABEL[m]}</Text>
                    <Text style={styles.popDesc}>{MODE_DESC[m]}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function modeColor(t: Tokens, m: ModeState): string {
  switch (m) {
    case 'plan':
      return t.colors.accent;
    case 'acceptEdits':
      return t.colors.working;
    case 'auto':
      return t.colors.done;
    case 'bypassPermissions':
      return t.colors.blocked;
    default:
      return t.colors.sub;
  }
}

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
    wrap: { backgroundColor: t.cyber ? alpha(t.colors.bg, 0.8) : t.colors.surface },
    row: { flexDirection: 'row', alignItems: 'center', height: 52, paddingLeft: 4, paddingRight: 12, gap: 8 },
    back: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
    who: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 1 },
    title: t.cyber
      ? { ...t.font('display', '700'), color: t.colors.red, fontSize: 13, letterSpacing: 1.2, textTransform: 'uppercase', ...t.glow(t.colors.red, 10) }
      : { ...t.font('ui', '700'), color: t.colors.text, fontSize: 16 },
    sub: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.sub, fontSize: 11 },
    ctl: {
      width: 30,
      height: 30,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: t.r(15),
      borderWidth: 1,
      borderColor: alpha(t.colors.accent, 0.35),
      backgroundColor: t.cyber ? 'transparent' : t.colors.surface2,
    },
    ctlOff: { opacity: 0.35 },
    chip: {
      height: 26,
      paddingHorizontal: 9,
      justifyContent: 'center',
      borderRadius: t.r(13),
      borderWidth: 1,
    },
    chipText: { fontSize: 11, ...t.font('ui', '700'), ...t.hud },
    status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    statusText: { fontSize: 11, ...t.font('ui', '700'), ...t.hud },
    hairline: { height: StyleSheet.hairlineWidth, backgroundColor: t.colors.hairline },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'flex-end', paddingRight: 10 },
    pop: {
      width: 270,
      backgroundColor: t.cyber ? alpha(t.colors.surface2, 0.97) : t.colors.surface2,
      borderRadius: t.radius.md,
      borderWidth: t.cyber ? 1 : StyleSheet.hairlineWidth,
      borderColor: t.cyber ? alpha(t.colors.accent, 0.4) : t.colors.hairline,
      ...t.boxGlow(t.colors.accent, 24, 0.35),
      paddingVertical: 6,
      overflow: 'hidden',
    },
    popHead: { ...t.font('ui', '700'), ...t.hud, color: t.cyber ? t.colors.red : t.colors.sub, fontSize: 11, paddingHorizontal: 14, paddingVertical: 8 },
    popRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
    popMark: { ...t.dot(8), backgroundColor: alpha(t.colors.sub, 0.3) },
    popName: { color: t.colors.text, fontSize: 14, ...t.font('ui', '600'), ...t.hud },
    popDesc: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.sub, fontSize: 11, marginTop: 2 },
  });

/* The agent screen's own header: back, who/where, and the live controls.
   The sub line is the StatusLine — model · effort · ctx · cwd, each readout
   the control that changes it — and the status pill opens the session's
   lifecycle verbs (new · rewind · resume). Replaces the native stack header,
   whose centred title lost to the back circle and the status chip on a phone. */
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  LIVE_MODE_KINDS,
  MODE_DESC,
  MODE_LABEL,
  MODE_ORDER,
  chipName,
  getServers,
  hostColor,
  hostName,
  type Agent,
  type AgentStatus,
  type KindCommand,
  type ModeState,
  type PermissionMode,
  type SessionReadout,
} from '@herdr/shared';
import { NeonRail } from '../cyber';
import { FlickerIn, Glitch, RailPacket, Scramble, StatusDot } from '../cyber-fx';
import { alpha, useStyles, useTheme, type Tokens } from '../theme';
import { Icon } from './Icon';
import { StatusLine } from './StatusLine';

export function AgentHeader({
  paneId,
  agent,
  status,
  working,
  online = true,
  mode,
  modeBusy,
  modeOpen,
  onModeOpen,
  readout,
  commands,
  disabled,
  onBack,
  onSetMode,
  onMenu,
  onSend,
  onPanel,
  onOpenDir,
}: {
  paneId: string;
  agent: Agent | undefined;
  status: AgentStatus | undefined;
  working: boolean;
  /** both streams up; false swaps the status pill for LINK LOST */
  online?: boolean;
  mode: ModeState;
  modeBusy: boolean;
  modeOpen: boolean;
  onModeOpen: (open: boolean) => void;
  readout: SessionReadout;
  /** the kind's manifest — which readouts are live, which verbs the pill has */
  commands: KindCommand[];
  /** agent working/blocked — readouts and the pill are plain text */
  disabled: boolean;
  onBack: () => void;
  onSetMode: (m: PermissionMode) => Promise<boolean>;
  /** tap or long-press on the name: rename / close */
  onMenu?: () => void;
  onSend: (text: string) => Promise<void> | void;
  onPanel: (ui: NonNullable<KindCommand['ui']>) => void;
  onOpenDir: (path: string) => void;
}) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const setModeOpen = onModeOpen;
  const kind = agent?.agent;
  const liveMode = !!kind && LIVE_MODE_KINDS.includes(kind) && mode !== 'unknown';
  const sColor = online ? t.status(status) : t.colors.blocked; // the skin's attention colour
  const mColor = modeColor(t, mode);
  // the status pill's sheet (new · rewind · resume) lives in the StatusLine
  const [sessionOpen, setSessionOpen] = useState(false);
  const hasLifecycle = commands.some((c) => ['new', 'rewind', 'resume'].includes(c.verb));
  const pillTap = online && !disabled && hasLifecycle ? () => setSessionOpen(true) : undefined;

  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        <Pressable onPress={onBack} hitSlop={10} style={styles.back} accessibilityLabel="back">
          <Icon name="back" size={26} color={t.cyber ? t.colors.red : t.colors.text} />
        </Pressable>
        <FlickerIn style={styles.who}>
          <Pressable onPress={onMenu} onLongPress={onMenu} disabled={!onMenu} accessibilityLabel="agent menu">
            <Glitch>
              <Scramble style={styles.title} numberOfLines={1}>
                {agent ? chipName(agent) : paneId}
              </Scramble>
            </Glitch>
          </Pressable>
          {!!agent && (
            <View style={styles.subRow}>
              {getServers().length > 1 && (
                <Text style={[styles.sub, { color: hostColor(agent.host), fontWeight: '700' }]}>{hostName(agent.host)} · </Text>
              )}
              <StatusLine
                agent={agent}
                readout={readout}
                commands={commands}
                disabled={disabled}
                style={[styles.sub, { flexShrink: 1 }]}
                session={sessionOpen}
                onSessionClose={() => setSessionOpen(false)}
                onSend={onSend}
                onPanel={onPanel}
                onOpenDir={onOpenDir}
              />
            </View>
          )}
        </FlickerIn>
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
        <Pressable
          style={styles.status}
          onPress={pillTap}
          disabled={!pillTap}
          hitSlop={8}
          accessibilityLabel={online ? `status ${status ?? 'unknown'}` : 'link lost, reconnecting'}
          accessibilityHint={pillTap ? 'new, rewind or resume the session' : undefined}
        >
          <StatusDot status={online ? status : 'blocked'} color={sColor} size={8} />
          <Text style={[styles.statusText, { color: sColor }, t.glow(sColor, 6)]}>
            {online ? status ?? '—' : 'link lost'}
          </Text>
        </Pressable>
      </View>
      {t.cyber ? (
        <View>
          <NeonRail />
          <RailPacket active={working} />
        </View>
      ) : (
        <View style={styles.hairline} />
      )}

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
      ? { ...t.font('display', '700'), color: t.colors.red, fontSize: t.sz('ui', 13), letterSpacing: 1.2, textTransform: 'uppercase', ...t.glow(t.colors.red, 10) }
      : { ...t.font('ui', '700'), color: t.colors.text, fontSize: t.sz('ui', 16) },
    subRow: { flexDirection: 'row', alignItems: 'baseline', minWidth: 0 },
    sub: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.sub, fontSize: t.sz('ui', 11) },
    ctlOff: { opacity: 0.35 },
    chip: {
      height: 26,
      paddingHorizontal: 9,
      justifyContent: 'center',
      borderRadius: t.r(13),
      borderWidth: 1,
    },
    chipText: { fontSize: t.sz('ui', 11), ...t.font('ui', '700'), ...t.hud },
    status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    statusText: { fontSize: t.sz('ui', 11), ...t.font('ui', '700'), ...t.hud },
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
    popHead: { ...t.font('ui', '700'), ...t.hud, color: t.cyber ? t.colors.red : t.colors.sub, fontSize: t.sz('ui', 11), paddingHorizontal: 14, paddingVertical: 8 },
    popRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
    popMark: { ...t.dot(8), backgroundColor: alpha(t.colors.sub, 0.3) },
    popName: { color: t.colors.text, fontSize: t.sz('ui', 14), ...t.font('ui', '600'), ...t.hud },
    popDesc: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.sub, fontSize: t.sz('ui', 11), marginTop: 2 },
  });

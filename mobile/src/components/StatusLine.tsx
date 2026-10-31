/* The agent header's `model · effort · ctx · cwd` line, where each readout
   is also the control that changes it (Capra's take on the web status
   line): model and effort open their pick sheet, the context size opens
   breakdown / compact (long-press goes straight to compact), the cwd opens
   the file browser there. Which readouts are live comes from the adapter's
   manifest; a kind without one (grok) gets plain text. Nested Text spans,
   so the row still truncates as one line on a narrow phone. The header's
   status pill opens the session sheet here too (new · rewind · resume), so
   every header control shares one skinned bottom sheet. */
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import {
  commandText,
  ctxHeat,
  currentValue,
  fmtTokens,
  getPlatform,
  shortModel,
  shortPath,
  type Agent,
  type KindCommand,
  type SessionReadout,
} from '@herdr/shared';
import { alpha, useStyles, useTheme, type Tokens } from '../theme';

type Pop = 'effort' | 'model' | 'ctx' | 'compact';

export function StatusLine({
  agent,
  readout,
  commands,
  disabled,
  style,
  session,
  onSessionClose,
  onSend,
  onPanel,
  onOpenDir,
}: {
  agent: Agent;
  readout: SessionReadout;
  commands: KindCommand[];
  /** agent working/blocked — readouts stay text */
  disabled: boolean;
  style: StyleProp<TextStyle>;
  /** the status pill was tapped: show the lifecycle sheet */
  session: boolean;
  onSessionClose: () => void;
  onSend: (text: string) => Promise<void> | void;
  onPanel: (ui: NonNullable<KindCommand['ui']>) => void;
  onOpenDir: (path: string) => void;
}) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const [pop, setPop] = useState<Pop | null>(null);
  const [arg, setArg] = useState('');
  const [busy, setBusy] = useState(false);
  // a session-wide verb (/clear) is one mis-tap from losing the context: the
  // first tap arms the row, the second fires — no system alert
  const [armed, setArmed] = useState<string | null>(null);
  const byVerb = new Map(commands.map((c) => [c.verb, c]));
  const lifecycle = commands.filter((c) => ['new', 'rewind', 'resume'].includes(c.verb));

  const close = () => {
    setPop(null);
    setArg('');
    setArmed(null);
    if (session) onSessionClose();
  };
  // an agent that starts working closes any half-made pick
  useEffect(() => {
    if (disabled) close();
  }, [disabled]);

  const runVerb = async (cmd: KindCommand) => {
    if (cmd.effect === 'session' && armed !== cmd.verb) return setArmed(cmd.verb);
    close();
    if (cmd.ui) return onPanel(cmd.ui);
    const text = commandText(cmd);
    if (!text) return;
    try {
      await onSend(text);
    } catch (e) {
      getPlatform().notifyError(String((e as Error)?.message ?? e));
    }
  };

  const fire = async (cmd: KindCommand, value?: string) => {
    close();
    const text = commandText(cmd, value);
    if (!text) return;
    setBusy(true);
    try {
      await onSend(text);
    } catch (e) {
      getPlatform().notifyError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const off = disabled || busy;
  const model = byVerb.get('model');
  const effort = byVerb.get('effort');
  const context = byVerb.get('context');
  const compact = byVerb.get('compact');
  const heat = ctxHeat(readout);
  const heatColor = heat === 'hot' ? t.colors.blocked : heat === 'warm' ? t.colors.working : null;
  const live = (on: boolean) => (on && !off ? styles.ctl : null);

  const segs: { key: string; text: string; on?: () => void; long?: () => void; color?: string | null }[] = [
    {
      key: 'model',
      text: (readout.model ? shortModel(readout.model) : null) ?? agent.displayAgent ?? agent.agent,
      on: model && (() => setPop('model')),
    },
  ];
  if (readout.effort || effort) segs.push({ key: 'effort', text: readout.effort ?? 'effort', on: effort && (() => setPop('effort')) });
  if (readout.ctx != null || context || compact) {
    segs.push({
      key: 'ctx',
      text: readout.ctx != null ? `${fmtTokens(readout.ctx)} ctx` : 'ctx',
      on: (context || compact) && (() => setPop('ctx')),
      long: compact && (() => setPop('compact')),
      color: heatColor,
    });
  }
  if (agent.cwd) {
    const cwd = agent.cwd;
    segs.push({ key: 'cwd', text: shortPath(cwd), on: () => onOpenDir(cwd) });
  }

  const picker = pop === 'effort' ? effort : pop === 'model' ? model : null;
  const cur = picker ? currentValue(picker, readout) : null;

  return (
    <>
      <Text style={style} numberOfLines={1}>
        {segs.map((s, i) => (
          <Text key={s.key}>
            {i > 0 && ' · '}
            <Text
              style={[live(!!s.on), s.color ? { color: s.color, ...(heat === 'hot' ? t.glow(s.color, 6) : {}) } : null]}
              onPress={s.on && !off ? s.on : undefined}
              onLongPress={s.long && !off ? s.long : undefined}
              suppressHighlighting={!s.on || off}
            >
              {s.text}
            </Text>
          </Text>
        ))}
      </Text>

      <Modal visible={!!pop || session} transparent animationType="fade" onRequestClose={close}>
        {/* padding on Android too: edge-to-edge (API 35+) never resizes the
            modal's window for the keyboard, so without it the compact input
            sits under the keys */}
        <KeyboardAvoidingView style={styles.sheetRoot} behavior="padding">
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="close" />
          {picker && (
            <View style={styles.sheet}>
              <Text style={styles.sheetName}>{picker.label}</Text>
              {!!picker.desc && <Text style={styles.sheetDesc}>{picker.desc}</Text>}
              {picker.values?.map((v) => {
                const on = v === cur;
                return (
                  <Pressable
                    key={v}
                    style={[styles.pick, on && { backgroundColor: alpha(t.colors.accent, 0.1) }]}
                    onPress={() => (on ? close() : void fire(picker, v))}
                  >
                    <View style={[styles.pickMark, on && styles.pickMarkOn]} />
                    <Text style={[styles.pickName, on && styles.pickNameOn]}>{v}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
          {pop === 'ctx' && (
            <View style={styles.sheet}>
              <Text style={styles.sheetName}>context</Text>
              <Text style={styles.sheetDesc}>
                {readout.ctx != null ? `${fmtTokens(readout.ctx)} tokens` : 'size unknown'}
                {readout.window ? ` of ${fmtTokens(readout.window)}` : ''}
              </Text>
              {context && (
                <Pressable style={styles.pick} onPress={() => void fire(context)}>
                  <View style={styles.pickMark} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickName}>breakdown</Text>
                    <Text style={styles.pickDesc}>{context.desc}</Text>
                  </View>
                </Pressable>
              )}
              {compact && (
                <Pressable style={styles.pick} onPress={() => setPop('compact')}>
                  <View style={styles.pickMark} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickName}>compact now…</Text>
                    <Text style={styles.pickDesc}>{compact.desc}</Text>
                  </View>
                </Pressable>
              )}
            </View>
          )}
          {session && !pop && (
            <View style={styles.sheet}>
              <Text style={styles.sheetName}>session</Text>
              {lifecycle.map((cmd) =>
                armed === cmd.verb ? (
                  <View key={cmd.verb} style={styles.armRow}>
                    <Text style={[styles.pickDesc, { flex: 1 }]}>{cmd.desc ?? `${cmd.label}?`}</Text>
                    <Pressable style={styles.armGo} onPress={() => void runVerb(cmd)} accessibilityLabel={`${cmd.label}, confirm`}>
                      <Text style={styles.goText}>{cmd.label}</Text>
                    </Pressable>
                    <Pressable style={styles.armKeep} onPress={() => setArmed(null)} accessibilityLabel="keep">
                      <Text style={styles.armKeepText}>keep</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable key={cmd.verb} style={styles.pick} onPress={() => void runVerb(cmd)} accessibilityLabel={cmd.label}>
                    <View style={styles.pickMark} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickName}>{cmd.label}</Text>
                      {!!cmd.desc && <Text style={styles.pickDesc}>{cmd.desc}</Text>}
                    </View>
                  </Pressable>
                ),
              )}
            </View>
          )}
          {pop === 'compact' && compact && (
            <View style={styles.sheet}>
              <Text style={styles.sheetName}>{compact.label}</Text>
              {!!compact.desc && <Text style={styles.sheetDesc}>{compact.desc}</Text>}
              <View style={styles.argRow}>
                <TextInput
                  autoFocus
                  value={arg}
                  onChangeText={setArg}
                  placeholder={compact.arg}
                  placeholderTextColor={t.colors.sub}
                  returnKeyType="go"
                  onSubmitEditing={() => void fire(compact, arg)}
                  style={styles.argInput}
                />
                <Pressable style={styles.go} onPress={() => void fire(compact, arg)}>
                  <Text style={styles.goText}>{compact.label}</Text>
                </Pressable>
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
    // a readout that's a control: a shade brighter than the rest of the line
    ctl: { color: t.cyber ? t.colors.accent : t.colors.text, textDecorationLine: t.cyber ? 'none' : 'underline', textDecorationStyle: 'dotted' },
    sheetRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
    sheet: {
      margin: 10,
      marginBottom: 24,
      paddingVertical: 8,
      backgroundColor: t.cyber ? alpha(t.colors.surface2, 0.97) : t.colors.surface2,
      borderRadius: t.radius.md,
      borderWidth: t.cyber ? 1 : StyleSheet.hairlineWidth,
      borderColor: t.cyber ? alpha(t.colors.accent, 0.4) : t.colors.hairline,
      ...t.boxGlow(t.colors.accent, 24, 0.35),
      overflow: 'hidden',
    },
    sheetName: {
      ...t.font(t.cyber ? 'display' : 'ui', '700'),
      ...t.hud,
      fontSize: t.sz('ui', 12),
      color: t.cyber ? t.colors.red : t.colors.accent,
      ...(t.cyber ? t.glow(t.colors.red, 8) : {}),
      paddingHorizontal: 14,
      paddingTop: 6,
    },
    sheetDesc: {
      ...t.font(t.cyber ? 'mono' : 'ui'),
      fontSize: t.sz('ui', 11),
      color: t.colors.sub,
      paddingHorizontal: 14,
      paddingTop: 2,
      paddingBottom: 8,
    },
    pick: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
    pickMark: { ...t.dot(8), backgroundColor: alpha(t.colors.sub, 0.3) },
    pickMarkOn: { backgroundColor: t.colors.accent, ...t.boxGlow(t.colors.accent, 8, 0.9) },
    pickName: { ...t.font('mono', '600'), fontSize: t.sz('ui', 15), color: t.colors.text },
    pickNameOn: { color: t.colors.accent, ...t.glow(t.colors.accent, 6) },
    pickDesc: { ...t.font(t.cyber ? 'mono' : 'ui'), fontSize: t.sz('ui', 11), color: t.colors.sub, marginTop: 2 },
    argRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 10, paddingBottom: 6, alignItems: 'center' },
    argInput: {
      flex: 1,
      minWidth: 0,
      ...t.font(t.cyber ? 'mono' : 'ui'),
      fontSize: t.sz('input', 15),
      color: t.colors.text,
      paddingHorizontal: 10,
      paddingVertical: 9,
      borderRadius: t.cyber ? 0 : t.radius.sm,
      borderWidth: 1,
      borderColor: t.cyber ? alpha(t.colors.accent, 0.3) : t.colors.hairline,
      backgroundColor: t.cyber ? 'transparent' : t.colors.surface3,
    },
    go: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: t.cyber ? 0 : t.radius.sm,
      backgroundColor: t.colors.accent,
    },
    goText: { ...t.font('ui', '700'), ...t.hud, fontSize: t.sz('ui', 13), color: t.colors.accentInk },
    armRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
    armGo: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: t.cyber ? 0 : t.radius.sm, backgroundColor: t.colors.blocked },
    armKeep: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: t.cyber ? 0 : t.radius.sm, backgroundColor: alpha(t.colors.sub, 0.2) },
    armKeepText: { ...t.font('ui', '700'), ...t.hud, fontSize: t.sz('ui', 13), color: t.colors.text },
  });

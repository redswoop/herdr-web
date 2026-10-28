/* Session controls strip above the composer — Capra's take on the web F-key
   bar (`1new 2rewind …`), laid out from the adapter's manifest. Slots are
   fixed: a verb this kind lacks keeps its place, dimmed. Pickers (effort)
   and compact's focus line open a bottom sheet; rewind/resume/perms hand off
   to the screen's own panels. */
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { DECK_VERBS, commandText, getPlatform, type CommandVerb, type KindCommand } from '@herdr/shared';
import { alpha, useStyles, useTheme, type Tokens } from '../theme';

export function CommandDeck({
  commands,
  disabled,
  effort,
  onSend,
  onPanel,
}: {
  commands: KindCommand[];
  /** agent working/blocked — every slot is off */
  disabled: boolean;
  /** current effort (readout), marked in the picker */
  effort: string | null;
  onSend: (text: string, cmd: KindCommand) => Promise<void> | void;
  onPanel: (ui: NonNullable<KindCommand['ui']>) => void;
}) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const [pop, setPop] = useState<CommandVerb | null>(null);
  const [arg, setArg] = useState('');
  const [busy, setBusy] = useState<CommandVerb | null>(null);
  const byVerb = new Map(commands.map((c) => [c.verb, c]));

  // an agent that starts working closes any half-made pick
  useEffect(() => {
    if (disabled) setPop(null);
  }, [disabled]);

  if (!commands.length) return null;
  const open = pop ? byVerb.get(pop) : undefined;

  const close = () => {
    setPop(null);
    setArg('');
  };

  const fire = async (cmd: KindCommand, value?: string) => {
    close();
    const text = commandText(cmd, value);
    if (!text) return;
    setBusy(cmd.verb);
    try {
      await onSend(text, cmd);
    } catch (e) {
      getPlatform().notifyError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const activate = (cmd: KindCommand) => {
    if (cmd.ui) return onPanel(cmd.ui);
    if (cmd.values || cmd.arg) return setPop(cmd.verb);
    void fire(cmd);
  };

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={styles.row}
      >
        {DECK_VERBS.map((verb, i) => {
          const cmd = byVerb.get(verb);
          const off = !cmd || disabled || busy != null;
          return (
            <Pressable
              key={verb}
              disabled={off}
              onPress={() => cmd && activate(cmd)}
              style={({ pressed }) => [
                styles.key,
                pressed && styles.keyOn,
                (pop === verb || busy === verb) && styles.keyOn,
                off && styles.keyOff,
              ]}
              accessibilityRole="button"
              accessibilityLabel={cmd ? `${cmd.label}: ${cmd.desc ?? ''}` : `${verb} (not supported)`}
            >
              <Text style={styles.num}>{i + 1}</Text>
              <Text style={styles.label}>{cmd?.label ?? verb}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Modal visible={!!open} transparent animationType="fade" onRequestClose={close}>
        {/* padding on Android too: edge-to-edge (API 35+) never resizes the
            modal's window for the keyboard, so without it the compact input
            sits under the keys */}
        <KeyboardAvoidingView style={styles.sheetRoot} behavior="padding">
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="close" />
          {open && (
            <View style={styles.sheet}>
              <Text style={styles.sheetName}>{open.label}</Text>
              {!!open.desc && <Text style={styles.sheetDesc}>{open.desc}</Text>}
              {open.values?.map((v) => {
                const on = v === effort;
                return (
                  <Pressable
                    key={v}
                    style={[styles.pick, on && { backgroundColor: alpha(t.colors.accent, 0.1) }]}
                    onPress={() => (on ? close() : void fire(open, v))}
                  >
                    <View style={[styles.pickMark, on && styles.pickMarkOn]} />
                    <Text style={[styles.pickName, on && styles.pickNameOn]}>{v}</Text>
                  </Pressable>
                );
              })}
              {!!open.arg && (
                <View style={styles.argRow}>
                  <TextInput
                    autoFocus
                    value={arg}
                    onChangeText={setArg}
                    placeholder={open.arg}
                    placeholderTextColor={t.colors.sub}
                    returnKeyType="go"
                    onSubmitEditing={() => void fire(open, arg)}
                    style={styles.argInput}
                  />
                  <Pressable style={styles.go} onPress={() => void fire(open, arg)}>
                    <Text style={styles.goText}>{open.label}</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
    wrap: {
      borderTopWidth: t.cyber ? 1 : StyleSheet.hairlineWidth,
      borderTopColor: t.cyber ? alpha(t.colors.red, 0.5) : t.colors.hairline,
      backgroundColor: t.cyber ? alpha(t.colors.bg, 0.8) : t.colors.surface,
    },
    row: { paddingHorizontal: 6, paddingVertical: 4, gap: t.cyber ? 0 : 2 },
    key: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 3,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: t.cyber ? 0 : t.radius.sm,
      borderRightWidth: t.cyber ? 1 : 0,
      borderRightColor: alpha(t.colors.accent, 0.14),
    },
    keyOn: { backgroundColor: alpha(t.colors.accent, t.cyber ? 0.12 : 0.15) },
    keyOff: { opacity: 0.35 },
    num: {
      ...t.font('mono', '700'),
      fontSize: t.sz('ui', 12),
      color: t.cyber ? t.colors.red : t.colors.accent,
      ...(t.cyber ? t.glow(t.colors.red, 6) : {}),
    },
    label: {
      ...t.font('mono'),
      fontSize: t.sz('ui', 12),
      color: t.cyber ? t.colors.accent : t.colors.text,
      ...(t.cyber ? { textTransform: 'uppercase', letterSpacing: 0.8 } : {}),
    },
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
  });

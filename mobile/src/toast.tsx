/* A one-line toast at the bottom of the screen ("copied", upload errors).
   Fire-and-forget from anywhere: toast('copied'). The host lives in
   _layout so it floats over every screen and modal. */
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { alpha, useStyles, type Tokens } from './theme';

type Listener = (msg: string) => void;
const listeners = new Set<Listener>();

export function toast(msg: string) {
  for (const l of listeners) l(msg);
}

/** a short tap confirmation, when the device can give one */
export function tick() {
  try {
    // optional native module: absent from older dev clients, present in builds
    // that bundle expo-haptics — either way the tap still does its job
    const h = require('expo-haptics') as typeof import('expo-haptics');
    void h.impactAsync(h.ImpactFeedbackStyle.Light).catch(() => {});
  } catch {
    // no haptics on this build
  }
}

export function ToastHost() {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState<{ id: number; text: string } | null>(null);
  useEffect(() => {
    let id = 0;
    const l: Listener = (text) => setMsg({ id: ++id, text });
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg((m) => (m?.id === msg.id ? null : m)), 1600);
    return () => clearTimeout(t);
  }, [msg]);
  if (!msg) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.host, { paddingBottom: insets.bottom + 86 }]}>
      <Animated.View key={msg.id} entering={FadeInDown.duration(160)} exiting={FadeOutDown.duration(200)} style={styles.pill}>
        <Text style={styles.text}>{msg.text}</Text>
      </Animated.View>
    </View>
  );
}

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
    host: { justifyContent: 'flex-end', alignItems: 'center' },
    pill: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: t.r(999),
      backgroundColor: t.cyber ? alpha(t.colors.bg, 0.92) : t.colors.surface3,
      borderWidth: 1,
      borderColor: alpha(t.colors.accent, 0.5),
      ...t.boxGlow(t.colors.accent, 14, 0.5),
    },
    text: { color: t.colors.accent, fontSize: t.sz('ui', 12), ...t.font('ui', '700'), ...t.hud, ...t.glow(t.colors.accent, 6) },
  });

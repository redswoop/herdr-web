/* Motion for the cyber skin, Reanimated-driven and all on the UI thread:
   a flicker-on for text and rows, a packet running down a neon rail, an
   alarm sweep across a needs-you banner, and the jack-in boot log on a cold
   launch. Every piece is a no-op on the stock theme. Nothing here goes near
   a transcript cell — see ios-text-layer-limit. */
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, {
  runOnJS,
  type SharedValue,
  type EasingFunction,
  cancelAnimation,
  Easing,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { alpha, useStyles, useTheme, type Tokens } from './theme';

/** a CRT-style flicker-on: three quick dips then solid. `delay` staggers
 *  list rows (cap it — a hundred rows should not take ten seconds). */
export function FlickerIn({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: ViewStyle }) {
  const t = useTheme();
  const o = useSharedValue(t.cyber ? 0 : 1);
  // once per mount: a list row's index (and so its delay) changes every time
  // the roster re-sorts, and re-flickering on each status flip is noise
  useEffect(() => {
    if (!t.cyber) {
      o.value = 1;
      return;
    }
    o.value = withDelay(
      Math.min(delay, 600),
      withSequence(
        withTiming(0.9, { duration: 40 }),
        withTiming(0.2, { duration: 40 }),
        withTiming(1, { duration: 60 }),
        withTiming(0.5, { duration: 50 }),
        withTiming(1, { duration: 120 }),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const a = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[style, a]}>{children}</Animated.View>;
}

/** a bright dash that runs the length of a rail every few seconds */
/** A packet sliding along a rail. `active` false parks it.
 *
 *  Cost model (Simulator, 2026-10-20): ANY running Reanimated animation keeps
 *  the frame loop alive — a sliding packet was ~20% of a core on an idle agent
 *  screen, and a withDelay "rest" inside withRepeat cost exactly the same as
 *  sliding nonstop. So one slide runs as a single withTiming and the rest is a
 *  JS setTimeout: nothing animates between slides, so nothing ticks. */
function useSlide(x: SharedValue<number>, run: boolean, w: number, period: number, duration: number, from: number, easing: EasingFunction) {
  useEffect(() => {
    if (!run) {
      cancelAnimation(x);
      x.value = from;
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (alive) timer = setTimeout(slide, Math.max(0, period - duration));
    };
    const slide = () => {
      if (!alive) return;
      x.value = from;
      x.value = withTiming(w - from, { duration, easing }, (finished) => {
        'worklet';
        if (finished) runOnJS(schedule)();
      });
    };
    slide();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      cancelAnimation(x);
      x.value = from;
    };
  }, [x, run, w, period, duration, from, easing]);
}

export function RailPacket({ color, period = 4200, active = true }: { color?: string; period?: number; active?: boolean }) {
  const t = useTheme();
  const [w, setW] = useState(0);
  const x = useSharedValue(-80);
  useSlide(x, t.cyber && w > 0 && active, w, period, 900, -80, SLIDE_EASE);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  if (!t.cyber || !active) return null;
  const c = color ?? t.colors.red;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <Animated.View style={[{ position: 'absolute', top: -1, width: 80, height: 4, backgroundColor: c, ...t.boxGlow(c, 10, 1) }, a]} />
    </View>
  );
}

const SLIDE_EASE = Easing.inOut(Easing.quad);
const SWEEP_EASE = Easing.inOut(Easing.cubic);

/** The blocked banner's sweep: one pass every 3.6s with a real rest between
 *  (a blocked pane can sit for an hour waiting on Armen). */
export function AlarmSweep({ color }: { color?: string }) {
  const t = useTheme();
  const [w, setW] = useState(0);
  const x = useSharedValue(-120);
  useSlide(x, t.cyber && w > 0, w, 3600, 1800, -120, SWEEP_EASE);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { skewX: '-20deg' }] }));
  if (!t.cyber) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, width: 120, backgroundColor: alpha(color ?? t.colors.blocked, 0.18) }, a]} />
    </View>
  );
}

/** a slow breathing glow for the thing that's live right now */
export function Pulse({ children, color, style }: { children: ReactNode; color: string; style?: ViewStyle }) {
  const t = useTheme();
  const v = useSharedValue(0.4);
  useEffect(() => {
    if (!t.cyber) return;
    v.value = withRepeat(withSequence(withTiming(1, { duration: 900 }), withTiming(0.4, { duration: 900 })), -1);
  }, [t.cyber, v]);
  const a = useAnimatedStyle(() => ({ opacity: 0.6 + v.value * 0.4 }));
  if (!t.cyber) return <View style={style}>{children}</View>;
  return <Animated.View style={[style, { ...t.boxGlow(color, 12, 0.9) }, a]}>{children}</Animated.View>;
}

const BOOT = [
  'CAPRA/OS 1.1 · jack-in',
  'link  ········ herdr daemon',
  'auth  ········ ok',
  'roster ······· streaming',
  'skin  ········ night city',
];

/** the jack-in boot log: a few lines type on over a second, then the whole
 *  thing fades. Shown once per cold launch, cyber only. */
export function BootLog({ onDone }: { onDone: () => void }) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!t.cyber) {
      onDone();
      return;
    }
    const timers = BOOT.map((_, i) => setTimeout(() => setN(i + 1), 120 + i * 140));
    timers.push(setTimeout(onDone, 120 + BOOT.length * 140 + 420));
    return () => timers.forEach(clearTimeout);
  }, [t.cyber, onDone]);
  if (!t.cyber) return null;
  return (
    <Animated.View pointerEvents="none" exiting={FadeOut.duration(260)} style={[StyleSheet.absoluteFill, styles.boot]}>
      <View style={styles.bootBox}>
        {BOOT.slice(0, n).map((l, i) => (
          <Text key={i} style={[styles.bootLine, i === 0 && styles.bootHead]}>
            {l}
          </Text>
        ))}
        {n < BOOT.length && <Text style={styles.cursor}>▮</Text>}
      </View>
    </Animated.View>
  );
}

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
    boot: { backgroundColor: t.colors.bg, justifyContent: 'center', alignItems: 'center', zIndex: 10 },
    bootBox: { width: 280, gap: 6 },
    bootLine: { ...t.font('mono'), color: t.colors.accent, fontSize: t.sz('ui', 13), letterSpacing: 1, ...t.glow(t.colors.accent, 8) },
    bootHead: { ...t.font('display', '700'), color: t.colors.red, fontSize: t.sz('ui', 13), letterSpacing: 2, ...t.glow(t.colors.red, 12), marginBottom: 6 },
    cursor: { ...t.font('mono'), color: t.colors.red, fontSize: t.sz('ui', 13) },
  });

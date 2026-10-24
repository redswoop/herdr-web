/* Motion for the cyber skin, Reanimated-driven and all on the UI thread:
   a flicker-on for text and rows, a packet running down a neon rail, an
   alarm sweep across a needs-you banner, and the jack-in boot log on a cold
   launch. Every piece is a no-op on the stock theme. Nothing here goes near
   a transcript cell — see ios-text-layer-limit. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextProps, type ViewStyle } from 'react-native';
import { getApiConfig } from '@herdr/shared';
import Animated, {
  runOnJS,
  type SharedValue,
  type EasingFunction,
  cancelAnimation,
  Easing,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
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

export function RailPacket({
  color,
  period = 4200,
  active = true,
  edge = 'top',
  size = 4,
}: {
  color?: string;
  period?: number;
  active?: boolean;
  /** which edge of the parent the packet rides */
  edge?: 'top' | 'bottom';
  size?: number;
}) {
  const t = useTheme();
  const [w, setW] = useState(0);
  const x = useSharedValue(-80);
  useSlide(x, t.cyber && w > 0 && active, w, period, 900, -80, SLIDE_EASE);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  if (!t.cyber || !active) return null;
  const c = color ?? t.colors.red;
  const place = edge === 'top' ? { top: -1 } : { bottom: 0 };
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <Animated.View style={[{ position: 'absolute', ...place, width: 80, height: size, backgroundColor: c, ...t.boxGlow(c, 10, 1) }, a]} />
    </View>
  );
}

/** Run `fn` every `period` ms while `run` — the JS-timer rest from useSlide,
 *  for effects that are a short burst with nothing animating in between. */
function useBurst(run: boolean, period: number, fn: () => void, first = period) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!run) return;
    let timer = setTimeout(function tick() {
      ref.current();
      timer = setTimeout(tick, period);
    }, first);
    return () => clearTimeout(timer);
  }, [run, period, first]);
}

/** A status dot: round on stock, a diamond on cyber. On cyber a working
 *  diamond ticks round and a blocked one flickers like a bad tube — both on
 *  JS timers with the UI thread asleep between bursts. */
export function StatusDot({
  status,
  size = 8,
  color,
  style,
}: {
  status?: string;
  size?: number;
  /** defaults to the theme's colour for `status` */
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const fx = t.cyber && !reduced;
  const c = color ?? t.status(status as never);
  const spin = fx && status === 'working';
  const flicker = fx && status === 'blocked';
  const rot = useSharedValue(45);
  const o = useSharedValue(1);
  useEffect(() => {
    if (!spin) {
      cancelAnimation(rot);
      rot.value = 45;
    }
  }, [spin, rot]);
  // a quarter-turn tick, not web's continuous spin: a diamond is 4-fold
  // symmetric so it reads the same, and the frame loop sleeps between ticks
  // (continuous was +7 points of a core on the home list, 2026-10-20)
  useBurst(spin, 1500, () => {
    rot.value = withTiming(rot.value + 90, { duration: 300, easing: SLIDE_EASE });
  }, 300);
  useEffect(() => {
    if (!flicker) {
      cancelAnimation(o);
      o.value = 1;
    }
  }, [flicker, o]);
  useBurst(
    flicker,
    2400,
    () => {
      o.value = withSequence(
        withTiming(0.25, { duration: 24 }),
        withTiming(0.85, { duration: 24 }),
        withTiming(1, { duration: 24 }),
      );
      setTimeout(() => {
        o.value = withSequence(withTiming(0.45, { duration: 48 }), withTiming(1, { duration: 48 }));
      }, 670);
    },
    900,
  );
  const cyber = t.cyber;
  const a = useAnimatedStyle(() => (cyber ? { transform: [{ rotate: `${rot.value}deg` }], opacity: o.value } : {}));
  const base: ViewStyle = cyber
    ? { width: size * 0.85, height: size * 0.85 }
    : { width: size, height: size, borderRadius: size / 2 };
  return <Animated.View style={[base, { backgroundColor: c }, t.boxGlow(c, size + 2, 0.9), style, a]} />;
}

/** The sign's periodic glitch: a 300 ms chromatic twitch every 7 s, like
 *  web's cy-glitch. Skew + nudge + a dip; nothing animates in between. */
export function Glitch({ children, style, period = 7000 }: { children: ReactNode; style?: StyleProp<ViewStyle>; period?: number }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const fx = t.cyber && !reduced;
  const x = useSharedValue(0);
  const k = useSharedValue(0);
  const o = useSharedValue(1);
  useBurst(fx, period, () => {
    const d = { duration: 48 };
    x.value = withSequence(withTiming(1, d), withTiming(-2, d), withTiming(0, d), withDelay(96, withTiming(2, d)), withTiming(0, d));
    k.value = withSequence(withTiming(0, d), withTiming(-10, d), withTiming(0, d), withDelay(96, withTiming(6, d)), withTiming(0, d));
    o.value = withSequence(withDelay(192, withTiming(0.8, d)), withTiming(1, d));
  });
  const a = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { skewX: `${k.value}deg` }],
    opacity: o.value,
  }));
  if (!fx) return <View style={style}>{children}</View>;
  return <Animated.View style={[style, a]}>{children}</Animated.View>;
}

/** The armed send button's breathing glow (web's cy-beacon): one breath per
 *  1.8 s with a real rest, only while `on`. Sits behind the button's face. */
export function Beacon({ color, on, radius = 10 }: { color: string; on: boolean; radius?: number }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const fx = t.cyber && !reduced && on;
  const o = useSharedValue(0.35);
  useEffect(() => {
    if (!fx) {
      cancelAnimation(o);
      o.value = 0.35;
    }
  }, [fx, o]);
  useBurst(
    fx,
    1800,
    () => {
      o.value = withSequence(withTiming(1, { duration: 500, easing: SLIDE_EASE }), withTiming(0.35, { duration: 600, easing: SLIDE_EASE }));
    },
    100,
  );
  const a = useAnimatedStyle(() => ({ opacity: o.value }));
  if (!fx) return null;
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, ...t.boxGlow(color, 16, 1) }, a]} />;
}

/* ---------------- scramble ---------------- */

const NOISE = '!<>-_\\/[]{}=+*^?#01ｱｲｳｴｵ';
const pick = (s: string) => s[Math.floor(Math.random() * s.length)];

/** Text that decodes from noise to itself — once on mount, again whenever
 *  the text changes (web's scramble). A short setInterval, nothing on the UI
 *  thread; plain Text on stock or under Reduce Motion. */
export function Scramble({ children, ms = 650, ...rest }: Omit<TextProps, 'children'> & { children: string; ms?: number }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const fx = t.cyber && !reduced;
  const [shown, setShown] = useState(children);
  useEffect(() => {
    const final = children;
    if (!fx || !final.trim() || final.length > 120) {
      setShown(final);
      return;
    }
    const chars = [...final];
    const reveal = chars.map((_, i) => (i / chars.length) * ms * 0.6 + Math.random() * ms * 0.4);
    const t0 = Date.now();
    const id = setInterval(() => {
      const e = Date.now() - t0;
      if (e >= ms) {
        clearInterval(id);
        setShown(final);
        return;
      }
      setShown(chars.map((ch, i) => (ch === ' ' || e >= reveal[i] ? ch : pick(NOISE))).join(''));
    }, 33);
    return () => clearInterval(id);
  }, [children, fx, ms]);
  return <Text {...rest}>{shown}</Text>;
}


const SLIDE_EASE = Easing.inOut(Easing.quad);
const SWEEP_EASE = Easing.inOut(Easing.cubic);

/** The blocked banner's sweep: one pass every 3.6s with a real rest between
 *  (a blocked pane can sit for an hour waiting on you). */
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

/** web's lines (cyber-fx.ts bootLog), host from the configured server */
function bootLines(): string[] {
  let host = 'localhost';
  try {
    const h = new URL(getApiConfig().baseUrl).hostname;
    if (h) host = /^[\d.]+$/.test(h) ? h : `${h.split('.')[0]}.tailnet`;
  } catch {}
  return [
    'HERDR//OS 20.77 — NETRUNNER EDITION',
    `> handshake ${host} .... OK`,
    '> decrypting roster ........... OK',
    '> ICE countermeasures ......... BYPASSED',
    '> waking the herd ............. 🐑',
    'WELCOME BACK, RUNNER',
  ];
}

const BOOT_PER = 170;

/** the jack-in boot log: a few lines type on over a second, then the whole
 *  thing fades. Shown once per cold launch, cyber only. */
export function BootLog({ onDone }: { onDone: () => void }) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const [n, setN] = useState(0);
  const [lines] = useState(bootLines);
  useEffect(() => {
    if (!t.cyber) {
      onDone();
      return;
    }
    const timers = lines.map((_, i) => setTimeout(() => setN(i + 1), 120 + i * BOOT_PER));
    timers.push(setTimeout(onDone, 120 + lines.length * BOOT_PER + 450));
    return () => timers.forEach(clearTimeout);
  }, [t.cyber, onDone, lines]);
  if (!t.cyber) return null;
  const last = lines.length - 1;
  return (
    <Animated.View pointerEvents="none" exiting={FadeOut.duration(260)} style={[StyleSheet.absoluteFill, styles.boot]}>
      <View style={styles.bootBox}>
        {lines.slice(0, n).map((l, i) => (
          <Scramble
            key={i}
            ms={BOOT_PER * 1.6}
            allowFontScaling={false}
            style={[styles.bootLine, (i === 0 || i === last) && styles.bootHead, i === last && styles.bootLast]}
          >
            {l}
          </Scramble>
        ))}
        {n < lines.length && <Text style={styles.cursor}>▮</Text>}
      </View>
    </Animated.View>
  );
}

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
    boot: { backgroundColor: t.colors.bg, justifyContent: 'center', alignItems: 'center', zIndex: 10 },
    bootBox: { alignSelf: 'stretch', paddingHorizontal: 22, gap: 6 },
    // decorative, one line each: fixed size, no Dynamic Type
    bootLine: { ...t.font('mono'), color: t.colors.accent, fontSize: 12, letterSpacing: 0.6, ...t.glow(t.colors.accent, 8) },
    bootHead: { ...t.font('display', '700'), color: t.colors.red, fontSize: 12, letterSpacing: 2, ...t.glow(t.colors.red, 12), marginBottom: 6 },
    bootLast: { marginBottom: 0, marginTop: 6 },
    cursor: { ...t.font('mono'), color: t.colors.red, fontSize: t.sz('ui', 13) },
  });

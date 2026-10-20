/* The Skia layer of the cyber skin: digital rain behind every screen. It
   is a GPU canvas, so it stays cheap: one Skia draw per frame of a few
   hundred glyph columns, no React re-renders. Loaded lazily — the module
   is native, and a dev client built before it was added must still boot. */
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { useTheme } from './theme';

type SkiaMod = typeof import('@shopify/react-native-skia');
let skia: SkiaMod | null | undefined;
function loadSkia(): SkiaMod | null {
  if (skia !== undefined) return skia;
  try {
    skia = require('@shopify/react-native-skia') as SkiaMod;
  } catch {
    skia = null;
  }
  return skia;
}

/** the red bloom at the top of every screen (web's body gradient) and a
 *  radial vignette over it — Skia gradients, so no stretched bitmaps */
export function Bloom() {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const [Comp, setComp] = useState<ComponentType<{ width: number; color: string }> | null>(null);
  useEffect(() => {
    if (!t.cyber) return;
    const mod = loadSkia();
    if (mod) setComp(() => makeBloom(mod));
  }, [t.cyber]);
  if (!t.cyber || !Comp) return null;
  return <Comp width={width} color={t.colors.red} />;
}

function makeBloom(mod: SkiaMod): ComponentType<{ width: number; color: string }> {
  const { Canvas, Rect, RadialGradient, vec } = mod;
  return function SkBloom({ width, color }) {
    const h = 360;
    return (
      <Canvas style={{ position: 'absolute', left: 0, top: -120, width, height: h }} pointerEvents="none">
        <Rect x={0} y={0} width={width} height={h}>
          <RadialGradient c={vec(width / 2, 60)} r={width * 0.75} colors={[color + '55', color + '22', color + '00']} />
        </Rect>
      </Canvas>
    );
  };
}

export function Vignette() {
  const t = useTheme();
  const { width, height } = useWindowDimensions();
  const [Comp, setComp] = useState<ComponentType<{ width: number; height: number }> | null>(null);
  useEffect(() => {
    if (!t.cyber) return;
    const mod = loadSkia();
    if (mod) setComp(() => makeVignette(mod));
  }, [t.cyber]);
  if (!t.cyber || !Comp) return null;
  return <Comp width={width} height={height} />;
}

function makeVignette(mod: SkiaMod): ComponentType<{ width: number; height: number }> {
  const { Canvas, Rect, RadialGradient, vec } = mod;
  return function SkVignette({ width, height }) {
    return (
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Rect x={0} y={0} width={width} height={height}>
          <RadialGradient c={vec(width / 2, height / 2)} r={Math.max(width, height) * 0.72} colors={['#00000000', '#00000000', '#000000a0']} positions={[0, 0.55, 1]} />
        </Rect>
      </Canvas>
    );
  };
}

const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ0123456789ABCDEF<>/\\|=+*#%&';
const CELL = 14;
const COLS_MAX = 22;

interface Column {
  x: number;
  head: number; // row of the brightest glyph
  speed: number; // rows per second
  len: number; // trail length in rows
  phase: number; // glyph scramble seed
}

/** Matrix-style rain in the chrome colour, dim enough to read over. */
export function DigitalRain({ opacity = 0.16 }: { opacity?: number }) {
  const t = useTheme();
  const { width, height } = useWindowDimensions();
  const [Rain, setRain] = useState<ComponentType<RainProps> | null>(null);
  useEffect(() => {
    if (!t.cyber) return;
    const mod = loadSkia();
    if (mod) setRain(() => makeRain(mod));
  }, [t.cyber]);
  if (!t.cyber || !Rain) return null;
  return <Rain width={width} height={height} color={t.colors.red} dim={t.colors.accent} opacity={opacity} />;
}

interface RainProps {
  width: number;
  height: number;
  color: string;
  dim: string;
  opacity: number;
}

function makeRain(mod: SkiaMod): ComponentType<RainProps> {
  const { Canvas, Group, Text: SkText, matchFont, useClock } = mod;
  return function Rain({ width, height, color, dim, opacity }: RainProps) {
    const font = useMemo(() => matchFont({ fontFamily: 'Menlo', fontSize: 11 }), []);
    const rows = Math.ceil(height / CELL) + 2;
    const columns = useMemo<Column[]>(() => {
      const n = Math.min(COLS_MAX, Math.floor(width / (CELL * 1.6)));
      const gap = width / n;
      return Array.from({ length: n }, (_, i) => ({
        x: i * gap + gap / 2 - 4,
        head: Math.random() * rows,
        speed: 3 + Math.random() * 6,
        len: 5 + Math.floor(Math.random() * 8),
        phase: Math.floor(Math.random() * 1000),
      }));
    }, [width, rows]);
    const clock = useClock();
    // one derived value per frame feeds every glyph: the row of each head
    const heads = useDerivedValue(() => {
      const s = clock.value / 1000;
      return columns.map((c) => (c.head + s * c.speed) % (rows + c.len));
    });
    return (
      <Canvas style={[StyleSheet.absoluteFill, { opacity }]} pointerEvents="none">
        <Group>
          {columns.map((c, ci) =>
            Array.from({ length: c.len }, (_, k) => (
              <RainGlyph key={`${ci}:${k}`} col={c} ci={ci} k={k} heads={heads} font={font} color={k === 0 ? '#ffffff' : k < 3 ? color : dim} rows={rows} />
            )),
          )}
        </Group>
      </Canvas>
    );
  };

  function RainGlyph({ col, ci, k, heads, font, color, rows }: { col: Column; ci: number; k: number; heads: SharedValue<number[]>; font: ReturnType<typeof matchFont>; color: string; rows: number }) {
    const y = useDerivedValue(() => {
      const row = heads.value[ci] - k;
      return row < 0 || row > rows ? -100 : row * CELL;
    });
    const text = useDerivedValue(() => {
      const row = Math.floor(heads.value[ci] - k);
      return GLYPHS[Math.abs(row * 31 + col.phase + k * 7) % GLYPHS.length];
    });
    const alpha = Math.max(0.08, 1 - k / col.len);
    return <SkText x={col.x} y={y} text={text} font={font} color={color} opacity={alpha} />;
  }
}

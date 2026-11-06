import { useEffect, useState, type ComponentType } from 'react';
import { View } from 'react-native';

/** A sparkline over [[t, v]] samples. Skia when the native module is there
 *  (the dev client has it), a row of thin bars otherwise — same shape as
 *  cyberdos's lazy Skia loading, so a missing module is a downgrade, not a
 *  crash. */
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

interface Props {
  points: [number, number][];
  color: string;
  floor?: number;
  ceil?: number;
  height?: number;
  width?: number;
}

function norm({ points, floor, ceil, height = 24 }: Props, width: number) {
  const t0 = points[0][0];
  const t1 = points[points.length - 1][0];
  const vs = points.map((p) => p[1]);
  const lo = floor ?? Math.min(...vs);
  const hi = Math.max(ceil ?? Math.max(...vs), lo + 1e-9);
  const span = Math.max(t1 - t0, 1);
  return points.map(([t, v]) => [((t - t0) / span) * width, height - 2 - ((v - lo) / (hi - lo)) * (height - 4)] as const);
}

function makeSkiaSpark(mod: SkiaMod): ComponentType<Props & { width: number }> {
  const { Canvas, Path } = mod;
  return function SkiaSpark(p) {
    const h = p.height ?? 24;
    const xy = norm(p, p.width);
    // SVG path strings: the one Path input every Skia version accepts
    const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    const area = `M0 ${h} ${xy.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')} L${p.width} ${h} Z`;
    return (
      <Canvas style={{ width: p.width, height: h }}>
        <Path path={area} color={p.color} opacity={0.14} />
        <Path path={line} color={p.color} style="stroke" strokeWidth={1.2} strokeJoin="round" />
      </Canvas>
    );
  };
}

export function Sparkline(props: Props) {
  const h = props.height ?? 24;
  const [width, setWidth] = useState(props.width ?? 0);
  const [Skia, setSkiaComp] = useState<ComponentType<Props & { width: number }> | null>(null);
  useEffect(() => {
    const mod = loadSkia();
    if (mod) setSkiaComp(() => makeSkiaSpark(mod));
  }, []);
  if (props.points.length < 2) return <View style={{ height: h }} />;
  return (
    <View style={{ height: h, width: '100%' }} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
      {width > 0 && (Skia ? (
        <Skia {...props} width={width} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: h, gap: 1 }}>
          {norm(props, width).filter((_, i, a) => i % Math.max(1, Math.ceil(a.length / 60)) === 0).map(([, y], i) => (
            <View key={i} style={{ flex: 1, height: Math.max(1, h - y), backgroundColor: props.color, opacity: 0.6 }} />
          ))}
        </View>
      ))}
    </View>
  );
}

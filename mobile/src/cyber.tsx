/* The light and chrome of the cyber skin that CSS gives the web for free:
   grid + haze behind every screen, scanlines + vignette over them, HUD
   corner brackets, hazard tape and neon rails. All tiles are white masks
   from scripts/cyber-assets.py, tinted with the live palette. Decoration
   only: nothing here takes a touch. */
import { Image, StyleSheet, View, type ViewStyle } from 'react-native';
import { alpha, useTheme } from './theme';

const TILE = {
  scan: require('../assets/cyber/scanlines.png'),
  grid: require('../assets/cyber/grid.png'),
  vignette: require('../assets/cyber/vignette.png'),
  haze: require('../assets/cyber/haze.png'),
  stripes: require('../assets/cyber/stripes.png'),
};

/** behind the navigator: the void, a faint grid, the red bloom at the top */
export function CyberBackdrop() {
  const t = useTheme();
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.bg }]}>
      <Image source={TILE.grid} resizeMode="repeat" style={[StyleSheet.absoluteFill, { tintColor: t.colors.red, opacity: 0.045 }]} />
      <Image
        source={TILE.haze}
        resizeMode="stretch"
        style={{ position: 'absolute', left: -40, right: -40, top: 0, height: 320, tintColor: t.colors.red, opacity: 0.2 }}
      />
    </View>
  );
}

/** over everything: CRT scanlines and a vignette; never eats a tap */
export function CyberOverlay() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Image source={TILE.scan} resizeMode="repeat" style={[StyleSheet.absoluteFill, { opacity: 0.13 }]} />
      <Image source={TILE.vignette} resizeMode="stretch" style={StyleSheet.absoluteFill} />
    </View>
  );
}

const L = 16;
const W = 2;
/** HUD corner brackets on a framed surface (parent needs position relative, which RN views are) */
export function Brackets({ color, inset = 0 }: { color?: string; inset?: number }) {
  const t = useTheme();
  if (!t.cyber) return null;
  const c = color ?? t.colors.red;
  const glow = t.boxGlow(c, 6, 0.8);
  const base: ViewStyle = { position: 'absolute', backgroundColor: c, ...glow };
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[base, { top: inset, left: inset, width: L, height: W }]} />
      <View style={[base, { top: inset, left: inset, width: W, height: L }]} />
      <View style={[base, { bottom: inset, right: inset, width: L, height: W }]} />
      <View style={[base, { bottom: inset, right: inset, width: W, height: L }]} />
    </View>
  );
}

/** diagonal hazard stripes; `height` sets the band, colour defaults to needs-you yellow */
export function HazardTape({ height = 7, color, opacity = 1, style }: { height?: number; color?: string; opacity?: number; style?: ViewStyle }) {
  const t = useTheme();
  if (!t.cyber) return null;
  return (
    <View pointerEvents="none" style={[{ height, overflow: 'hidden', backgroundColor: '#000' }, style]}>
      <Image source={TILE.stripes} resizeMode="repeat" style={[StyleSheet.absoluteFill, { tintColor: color ?? t.colors.blocked, opacity }]} />
    </View>
  );
}

/** the glowing hairline under the header / above the composer */
export function NeonRail({ color, style }: { color?: string; style?: ViewStyle }) {
  const t = useTheme();
  if (!t.cyber) return null;
  const c = color ?? t.colors.red;
  return (
    <View
      pointerEvents="none"
      style={[{ height: 2, backgroundColor: alpha(c, 0.7), ...t.boxGlow(c, 12, 0.6) }, style]}
    />
  );
}

/** a translucent stripe overlay for hazard-tinted banners */
export function StripeFill({ color, opacity = 0.14 }: { color?: string; opacity?: number }) {
  const t = useTheme();
  if (!t.cyber) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Image
        source={TILE.stripes}
        resizeMode="repeat"
        style={[StyleSheet.absoluteFill, { tintColor: color ?? t.colors.blocked, opacity }]}
      />
    </View>
  );
}

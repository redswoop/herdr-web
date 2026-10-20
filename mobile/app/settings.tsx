import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useBoot } from '../src/boot';
import { Screen } from '../src/cyber';
import { palettesFor, type Theme } from '@herdr/shared/palettes';
import { FONT_AREAS, FONT_MAX, FONT_MIN, FONT_STEP } from '@herdr/shared';
import { paletteOf, setFont, setPalette, setTheme } from '../src/prefs';
import { setAutocorrect, useAutocorrect } from '../src/device-prefs';
import { checkForUpdate, restartForUpdate, updateInfo, updateReady } from '../src/updates';
import { loadSettings, saveSettings } from '../src/settings-store';
import { alpha, useStyles, useTheme, type Tokens } from '../src/theme';

const APP_VERSION = Constants.expoConfig?.version ?? '?';
// the store build number is assigned remotely by EAS; app.json's is a stub
const BUILD_NUMBER = Constants.nativeBuildVersion ?? '';

export default function SettingsScreen() {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const router = useRouter();
  const { remount } = useBoot();
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadSettings().then((s) => {
      setBaseUrl(s.baseUrl);
      setToken(s.token);
    });
  }, []);

  const probe = async () => {
    const url = baseUrl.trim().replace(/\/$/, '');
    const tok = token.trim();
    // On web an empty URL is a real setting: relative /api against whatever
    // origin served the page (the dev-origin proxy fronts both). Native has no
    // origin to be relative to, so it still needs an absolute URL.
    if (!url && Platform.OS !== 'web') {
      setError('server URL is required');
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const q = tok ? `?token=${encodeURIComponent(tok)}` : '';
      const r = await fetch(`${url}/api/roster${q}`);
      if (r.status === 401) {
        setError("that token didn't match");
        setBusy(false);
        return;
      }
      if (!r.ok) throw new Error(r.statusText || `HTTP ${r.status}`);
      await saveSettings({ baseUrl: url, token: tok });
      await remount();
      setOk('connected — roster looks good');
      setTimeout(() => router.replace('/'), 300);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  // web may legitimately run same-origin with an empty URL
  const blocked = busy || (!baseUrl.trim() && Platform.OS !== 'web');

  return (
    <Screen>
    <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.hint} allowFontScaling={false}>
        Use your tailscale-serve HTTPS URL so ATS stays happy in release builds.
      </Text>
      <Text style={styles.label}>server URL</Text>
      <TextInput
        style={styles.input}
        value={baseUrl}
        onChangeText={setBaseUrl}
        placeholder="https://stormer.….ts.net"
        placeholderTextColor={t.colors.sub}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        keyboardType="url"
      />
      <Text style={styles.label}>access token</Text>
      <TextInput
        style={styles.input}
        value={token}
        onChangeText={setToken}
        placeholder="HERDR_WEB_TOKEN"
        placeholderTextColor={t.colors.sub}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
      {!!ok && <Text style={styles.ok}>{ok}</Text>}
      <Pressable
        style={[styles.btn, blocked && styles.btnDisabled]}
        disabled={blocked}
        onPress={probe}
      >
        {busy ? (
          <ActivityIndicator color={t.colors.accentInk} />
        ) : (
          <Text style={styles.btnText}>save & probe</Text>
        )}
      </Pressable>
      <Appearance />
      <TextSize />
      <ComposerPrefs />
      <Pressable style={styles.labLink} onPress={() => router.push('/lab')}>
        <Text style={styles.labText}>render lab → the empty-bubble diagnostics</Text>
      </Pressable>
      <About />
    </ScrollView>
    </Screen>
  );
}

const THEMES: { id: Theme; label: string }[] = [
  { id: 'default', label: 'stock' },
  { id: 'cyber', label: 'cyber' },
];

/** version, build, and which over-the-air update is running; tap to check */
function About() {
  const styles = useStyles(makeStyles);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);
  const u = updateInfo();
  const ready = updateReady();
  const check = async () => {
    setBusy(true);
    try {
      const r = await checkForUpdate();
      setNonce((n) => n + 1);
      if (r) {
        Alert.alert('Update ready', 'Restart Capra to apply it now?', [
          { text: 'later', style: 'cancel' },
          { text: 'restart', onPress: () => void restartForUpdate() },
        ]);
      }
    } finally {
      setBusy(false);
    }
  };
  const when = u.createdAt
    ? u.createdAt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;
  return (
    <Pressable onPress={busy ? undefined : check} accessibilityLabel="check for updates" key={nonce}>
      <Text style={styles.version}>
        Capra {APP_VERSION}
        {BUILD_NUMBER ? ` (${BUILD_NUMBER})` : ''}
        {' · '}
        {u.enabled ? `update ${u.id}${when ? ` · ${when}` : ''}` : 'updates off'}
      </Text>
      <Text style={styles.versionSub}>
        {busy ? 'checking…' : ready ? 'update ready · tap to restart' : u.enabled ? 'tap to check for updates' : 'dev client'}
      </Text>
    </Pressable>
  );
}

/** keyboard behaviour in the composer — this device */
function ComposerPrefs() {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const autocorrect = useAutocorrect();
  return (
    <View style={styles.section}>
      <Text style={styles.label}>composer</Text>
      <View style={styles.fontRow}>
        <View style={styles.fontHead}>
          <Text style={styles.fontName}>autocorrect</Text>
          <Text style={styles.fontHint} numberOfLines={2}>
            spelling, capitals and suggestions; off keeps paths and flags as typed
          </Text>
        </View>
        <Switch
          value={autocorrect}
          onValueChange={setAutocorrect}
          trackColor={{ true: t.colors.accent, false: t.colors.surface3 }}
          thumbColor={t.cyber ? t.colors.bg : undefined}
          accessibilityLabel="autocorrect in the composer"
        />
      </View>
    </View>
  );
}

/** the four per-device multipliers web has; every tap applies live */
function TextSize() {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const fonts = t.fonts; // tokens rebuild on every change, so this is current
  return (
    <View style={styles.section}>
      <Text style={styles.label}>text size</Text>
      {FONT_AREAS.map((a) => {
        const v = fonts[a.key];
        return (
          <View key={a.key} style={styles.fontRow}>
            <View style={styles.fontHead}>
              <Text style={styles.fontName}>{a.label.toLowerCase()}</Text>
              <Text style={styles.fontHint} numberOfLines={1}>{a.hint}</Text>
            </View>
            <View style={styles.stepper}>
              <Pressable
                style={[styles.stepBtn, v <= FONT_MIN && styles.stepBtnOff]}
                disabled={v <= FONT_MIN}
                onPress={() => setFont(a.key, v - FONT_STEP)}
                accessibilityLabel={`${a.label} smaller`}
              >
                <Text style={styles.stepText}>−</Text>
              </Pressable>
              <Pressable onPress={() => setFont(a.key, 1)} accessibilityLabel={`${a.label} back to 100%`} style={styles.pct}>
                <Text style={[styles.pctText, v !== 1 && styles.pctTextOn]}>{Math.round(v * 100)}%</Text>
              </Pressable>
              <Pressable
                style={[styles.stepBtn, v >= FONT_MAX && styles.stepBtnOff]}
                disabled={v >= FONT_MAX}
                onPress={() => setFont(a.key, v + FONT_STEP)}
                accessibilityLabel={`${a.label} larger`}
              >
                <Text style={styles.stepText}>+</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
      <Text style={styles.hint} allowFontScaling={false}>this device only · tap the percentage to reset</Text>
    </View>
  );
}

/** theme + palette: the pick syncs to every device through /api/prefs */
function Appearance() {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const presets = palettesFor(t.theme);
  const current = paletteOf(t.theme);
  return (
    <View style={styles.section}>
      <Text style={styles.label}>appearance</Text>
      <View style={styles.seg}>
        {THEMES.map((th) => {
          const on = th.id === t.theme;
          return (
            <Pressable
              key={th.id}
              style={[styles.segBtn, on && styles.segBtnOn]}
              onPress={() => setTheme(th.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.segText, on && styles.segTextOn]}>{th.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {presets.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatches}>
          {presets.map((p) => {
            const on = p.id === current;
            // the stock preset's colours are the stylesheet's own, not in p.colors
            const c = p.stock ? t.theme === 'cyber' ? { red: '#ff6a5c', accent: '#5fe3d4', hot: '#fcee0a' } : {} : p.colors;
            return (
              <Pressable
                key={p.id}
                style={[styles.swatch, on && styles.swatchOn]}
                onPress={() => setPalette(t.theme, p.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${p.name}: ${p.tag}`}
              >
                <View style={styles.chips}>
                  {[c.red, c.accent, c.hot].map((hex, i) => (
                    <View key={i} style={[styles.chip, { backgroundColor: hex ?? t.colors.sub }]} />
                  ))}
                </View>
                <Text style={[styles.swatchName, on && styles.swatchNameOn]} numberOfLines={1}>
                  {p.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      {current === 'custom' && presets.length > 0 && (
        <Text style={styles.hint} allowFontScaling={false}>custom colours, set from the web prefs panel</Text>
      )}
    </View>
  );
}

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 20, gap: 8 },
  section: { marginTop: 20, gap: 10 },
  seg: {
    flexDirection: 'row',
    backgroundColor: t.colors.surface2,
    borderRadius: t.radius.md,
    padding: 3,
    gap: 3,
  },
  segBtn: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: t.r(11), borderWidth: t.cyber ? 1 : 0, borderColor: 'transparent' },
  segBtnOn: t.cyber
    ? { backgroundColor: alpha(t.colors.accent, 0.16), borderColor: t.colors.accent, ...t.boxGlow(t.colors.accent, 14) }
    : { backgroundColor: t.colors.accent },
  segText: { ...t.font('ui', '600'), ...t.hud, color: t.colors.sub, fontSize: t.cyber ? 12 : 14 },
  segTextOn: t.cyber ? { color: t.colors.accent, ...t.glow(t.colors.accent, 8) } : { color: t.colors.accentInk },
  swatches: { gap: 8, paddingVertical: 2 },
  swatch: {
    width: 104,
    padding: 10,
    gap: 8,
    backgroundColor: t.glass,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.cyber ? alpha(t.colors.red, 0.3) : t.colors.hairline,
  },
  swatchOn: t.cyber ? { borderColor: t.colors.red, ...t.boxGlow(t.colors.red, 14, 0.5) } : { borderColor: t.colors.accent },
  chips: { flexDirection: 'row', gap: 4 },
  chip: { flex: 1, height: 18, borderRadius: t.r(4), transform: t.cyber ? [{ skewX: '-12deg' }] : [] },
  swatchName: t.cyber
    ? { ...t.font('display', '700'), color: t.colors.sub, fontSize: t.sz('ui', 10), letterSpacing: 1, textTransform: 'uppercase' }
    : { ...t.font('ui', '600'), color: t.colors.sub, fontSize: t.sz('ui', 12) },
  swatchNameOn: { color: t.colors.text, ...t.glow(t.colors.red, 8) },
  hint: { ...t.font('ui'), color: t.colors.sub, fontSize: t.px('ui', 13), marginBottom: 12, lineHeight: t.px('ui', 18) },
  fontRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  fontHead: { flex: 1, minWidth: 0 },
  fontName: { ...t.font('ui', '600'), color: t.colors.text, fontSize: t.sz('ui', 15) },
  fontHint: { ...t.font('ui'), color: t.colors.sub, fontSize: t.sz('ui', 12), marginTop: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.r(10),
    backgroundColor: t.cyber ? alpha(t.colors.accent, 0.1) : t.colors.surface2,
    borderWidth: t.cyber ? 1 : 0,
    borderColor: alpha(t.colors.accent, 0.35),
  },
  stepBtnOff: { opacity: 0.35 },
  stepText: { ...t.font('ui', '600'), color: t.colors.text, fontSize: t.sz('ui', 18), lineHeight: 22 },
  pct: { minWidth: 52, alignItems: 'center', paddingVertical: 6 },
  pctText: { ...t.font(t.cyber ? 'mono' : 'ui'), ...t.hud, color: t.colors.sub, fontSize: t.sz('ui', 13) },
  pctTextOn: { color: t.colors.accent },
  label: {
    color: t.cyber ? t.colors.red : t.colors.sub,
    opacity: t.cyber ? 0.85 : 1,
    fontSize: t.cyber ? 11 : 12,
    ...t.font(t.cyber ? 'display' : 'ui', '700'),
    letterSpacing: t.cyber ? 1.5 : 0,
    textTransform: 'uppercase',
    marginTop: 8,
  },
  input: {
    backgroundColor: t.cyber ? alpha('#000000', 0.45) : t.colors.surface2,
    borderWidth: t.cyber ? 1 : 0,
    borderColor: alpha(t.colors.accent, 0.25),
    borderRadius: t.radius.md,
    color: t.colors.text,
    ...t.font('ui'),
    fontSize: t.sz('ui', 16),
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  error: { ...t.font('ui'), color: t.colors.blocked, marginTop: 8 },
  ok: { ...t.font('ui'), color: t.colors.done, marginTop: 8 },
  btn: {
    marginTop: 16,
    backgroundColor: t.cyber ? t.colors.hot : t.colors.accent,
    ...t.boxGlow(t.colors.hot, 14, 0.5),
    borderRadius: t.radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: t.cyber ? '#000000' : t.colors.accentInk, ...t.font('ui', '700'), fontSize: t.cyber ? 14 : 16, ...t.hud },
  labLink: { marginTop: 24, alignItems: 'center', padding: 10 },
  labText: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.accent, fontSize: t.sz('ui', 13), ...t.glow(t.colors.accent, 6) },
  version: {
    marginTop: 8,
    color: t.colors.sub,
    ...t.font('ui'),
    fontSize: t.sz('ui', 12),
    textAlign: 'center',
  },
  versionSub: { color: t.colors.sub, ...t.font('ui'), fontSize: t.sz('ui', 11), textAlign: 'center', marginTop: 2, opacity: 0.8 },
});

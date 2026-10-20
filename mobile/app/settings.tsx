import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useBoot } from '../src/boot';
import { Screen } from '../src/cyber';
import { palettesFor, type Theme } from '@herdr/shared/palettes';
import { paletteOf, setPalette, setTheme } from '../src/prefs';
import { loadSettings, saveSettings } from '../src/settings-store';
import { alpha, useStyles, useTheme, type Tokens } from '../src/theme';

const APP_VERSION = Constants.expoConfig?.version ?? '?';
const BUILD_NUMBER =
  Constants.expoConfig?.ios?.buildNumber ??
  String(Constants.expoConfig?.android?.versionCode ?? '');

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
      <Text style={styles.hint}>
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
      <Pressable style={styles.labLink} onPress={() => router.push('/lab')}>
        <Text style={styles.labText}>render lab → the empty-bubble diagnostics</Text>
      </Pressable>
      <Text style={styles.version}>
        Capra {APP_VERSION}
        {BUILD_NUMBER ? ` (${BUILD_NUMBER})` : ''}
        {' · '}
        {String(Constants.expoConfig?.extra?.gitSha ?? '?')}
      </Text>
    </ScrollView>
    </Screen>
  );
}

const THEMES: { id: Theme; label: string }[] = [
  { id: 'default', label: 'stock' },
  { id: 'cyber', label: 'cyber' },
];

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
        <Text style={styles.hint}>custom colours, set from the web prefs panel</Text>
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
    ? { ...t.font('display', '700'), color: t.colors.sub, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }
    : { ...t.font('ui', '600'), color: t.colors.sub, fontSize: 12 },
  swatchNameOn: { color: t.colors.text, ...t.glow(t.colors.red, 8) },
  hint: { ...t.font('ui'), color: t.colors.sub, fontSize: 13, marginBottom: 12, lineHeight: 18 },
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
    fontSize: 16,
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
  labText: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.accent, fontSize: 13, ...t.glow(t.colors.accent, 6) },
  version: {
    marginTop: 8,
    color: t.colors.sub,
    ...t.font('ui'),
    fontSize: 12,
    textAlign: 'center',
  },
});

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useBoot } from '../src/boot';
import { loadSettings, saveSettings } from '../src/settings-store';
import { colors, radius } from '../src/theme';

export default function SettingsScreen() {
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
    const t = token.trim();
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
      const q = t ? `?token=${encodeURIComponent(t)}` : '';
      const r = await fetch(`${url}/api/roster${q}`);
      if (r.status === 401) {
        setError("that token didn't match");
        setBusy(false);
        return;
      }
      if (!r.ok) throw new Error(r.statusText || `HTTP ${r.status}`);
      await saveSettings({ baseUrl: url, token: t });
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
    <View style={styles.root}>
      <Text style={styles.hint}>
        Use your tailscale-serve HTTPS URL so ATS stays happy in release builds.
      </Text>
      <Text style={styles.label}>server URL</Text>
      <TextInput
        style={styles.input}
        value={baseUrl}
        onChangeText={setBaseUrl}
        placeholder="https://stormer.….ts.net"
        placeholderTextColor={colors.sub}
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
        placeholderTextColor={colors.sub}
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
          <ActivityIndicator color={colors.accentInk} />
        ) : (
          <Text style={styles.btnText}>save & probe</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: 20,
    gap: 8,
  },
  hint: { color: colors.sub, fontSize: 13, marginBottom: 12, lineHeight: 18 },
  label: {
    color: colors.sub,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginTop: 8,
  },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  error: { color: colors.blocked, marginTop: 8 },
  ok: { color: colors.done, marginTop: 8 },
  btn: {
    marginTop: 16,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
});

/* Settings → hosts: every herdr-web server this phone talks to. The first
   is the primary (bare ids, prefs, the default launcher box); the rest show
   up with @host chips. Add by URL+token here, or — the one-tap way — scan
   the QR `npm run link` prints on the box, which deep-links straight in. */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { describeError, type ServerConf, type WhoAmI } from '@herdr/shared';
import { useBoot } from '../boot';
import { useRoster } from '../roster';
import { loadServers, makePrimary, removeServer, renameServer, upsertServer } from '../settings-store';
import { alpha, useStyles, useTheme, type Tokens } from '../theme';
import { Icon } from './Icon';

async function probe(baseUrl: string, token: string): Promise<WhoAmI> {
  const url = baseUrl.trim().replace(/\/$/, '');
  const q = token ? `?token=${encodeURIComponent(token)}` : '';
  const r = await fetch(`${url}/api/whoami${q}`);
  if (r.status === 401) throw new Error("that token didn't match");
  if (r.status === 404) {
    // a pre-multi-host daemon: no whoami, but a roster still proves the pair
    const r2 = await fetch(`${url}/api/roster${q}`);
    if (r2.status === 401) throw new Error("that token didn't match");
    if (!r2.ok) throw new Error(r2.statusText || `HTTP ${r2.status}`);
    return { host: new URL(url).hostname.split('.')[0] ?? 'host', publicUrl: url, build: '?', bootedAt: '' };
  }
  if (!r.ok) throw new Error(r.statusText || `HTTP ${r.status}`);
  return (await r.json()) as WhoAmI;
}

export function ServerList() {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const router = useRouter();
  const { remount } = useBoot();
  const { hosts } = useRoster();
  const [servers, setServers] = useState<ServerConf[] | null>(null); // null = not read yet
  const [adding, setAdding] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(() => {
    loadServers().then(setServers);
  }, []);
  useEffect(reload, [reload]);
  useEffect(() => {
    if (servers && !servers.length) setAdding(true); // nothing enrolled: the form is the screen
  }, [servers]);
  const list = servers ?? [];

  const apply = async (work: () => Promise<void>) => {
    await work();
    reload();
    await remount();
  };

  const add = async () => {
    const url = baseUrl.trim().replace(/\/$/, '');
    if (!url && Platform.OS !== 'web') {
      setError('server URL is required');
      return;
    }
    setBusy('add');
    setError(null);
    try {
      const who = await probe(url, token.trim());
      await apply(async () => {
        await upsertServer({ baseUrl: url, token: token.trim() || null, name: who.host });
      });
      setBaseUrl('');
      setToken('');
      setAdding(false);
      if (list.length === 0) setTimeout(() => router.replace('/'), 300);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  };

  const recheck = async (s: ServerConf) => {
    setBusy(s.id);
    setError(null);
    try {
      const who = await probe(s.baseUrl, s.token ?? '');
      if (who.host && who.host !== s.name) await apply(() => renameServer(s.id, who.host));
      Alert.alert(s.name, `${who.host} · build ${who.build}\n${who.publicUrl}`);
    } catch (e) {
      setError(`${s.name}: ${describeError(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const menu = (s: ServerConf) => {
    const primary = list[0]?.id === s.id;
    Alert.alert(s.name, s.baseUrl, [
      { text: 'check', onPress: () => void recheck(s) },
      {
        text: 'share link',
        onPress: () => {
          // the capra:// link, token included — AirDrop it to another device
          // and it enrols in one tap. Treat it like the token itself.
          const p = new URLSearchParams({ server: s.baseUrl, name: s.name });
          if (s.token) p.set('token', s.token);
          void Share.share({ message: `capra://settings?${p.toString()}` });
        },
      },
      ...(primary ? [] : [{ text: 'make primary', onPress: () => void apply(() => makePrimary(s.id)) }]),
      {
        text: 'remove',
        style: 'destructive' as const,
        onPress: () =>
          Alert.alert(`Remove ${s.name}?`, 'Its agents leave the list; the server itself is untouched.', [
            { text: 'cancel', style: 'cancel' },
            { text: 'remove', style: 'destructive', onPress: () => void apply(() => removeServer(s.id)) },
          ]),
      },
      { text: 'cancel', style: 'cancel' },
    ]);
  };

  return (
    <View style={styles.section}>
      <Text style={styles.label}>hosts</Text>
      {list.map((s, i) => {
        const h = hosts.find((x) => x.id === s.id);
        const state = !h ? '' : h.authNeeded ? 'token rejected' : h.connected ? (h.herdrDown ? 'herdr down' : 'connected') : 'unreachable';
        const ok = !!h?.connected && !h.herdrDown;
        return (
          <Pressable key={s.id} style={styles.row} onPress={() => menu(s)} onLongPress={() => menu(s)}>
            <View style={[styles.dot, ok ? styles.dotOk : h?.authNeeded ? styles.dotBad : null]} />
            <View style={styles.rowBody}>
              <Text style={styles.rowName} numberOfLines={1}>
                {s.name}
                {i === 0 && list.length > 1 ? <Text style={styles.primary}>  primary</Text> : null}
              </Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {s.baseUrl.replace(/^https?:\/\//, '')}
                {state ? ` · ${state}` : ''}
              </Text>
            </View>
            {busy === s.id ? <ActivityIndicator color={t.colors.accent} /> : <Icon name="chevron-right" size={16} color={t.colors.sub} />}
          </Pressable>
        );
      })}

      {adding ? (
        <View style={styles.form}>
          <Text style={styles.hint} allowFontScaling={false}>
            Fastest: on the box run <Text style={styles.mono}>npm run link</Text> and scan the QR — it opens here with
            everything filled in. Or paste the tailscale-serve HTTPS URL and token:
          </Text>
          <TextInput
            style={styles.input}
            value={baseUrl}
            onChangeText={setBaseUrl}
            placeholder="https://host.….ts.net"
            placeholderTextColor={t.colors.sub}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            keyboardType="url"
          />
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
          <View style={styles.formRow}>
            {list.length > 0 && (
              <Pressable style={styles.btnGhost} onPress={() => setAdding(false)} disabled={busy === 'add'}>
                <Text style={styles.btnGhostText}>cancel</Text>
              </Pressable>
            )}
            <Pressable
              style={[styles.btn, (busy === 'add' || (!baseUrl.trim() && Platform.OS !== 'web')) && styles.btnDisabled]}
              disabled={busy === 'add' || (!baseUrl.trim() && Platform.OS !== 'web')}
              onPress={add}
            >
              {busy === 'add' ? <ActivityIndicator color={t.colors.accentInk} /> : <Text style={styles.btnText}>probe & add</Text>}
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable style={styles.addRow} onPress={() => setAdding(true)}>
          <Icon name="plus" size={16} color={t.colors.accent} />
          <Text style={styles.addText}>add a host</Text>
        </Pressable>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
    section: { gap: 8 },
    label: { ...t.font('ui', '600'), ...t.hud, color: t.colors.sub, fontSize: t.sz('ui', 12), textTransform: 'uppercase', marginBottom: 2 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      backgroundColor: t.glass,
      borderRadius: t.radius.md,
      borderWidth: 1,
      borderColor: t.cyber ? alpha(t.colors.accent, 0.25) : t.colors.hairline,
    },
    rowBody: { flex: 1, minWidth: 0 },
    rowName: { ...t.font('ui', '600'), color: t.colors.text, fontSize: t.sz('ui', 15) },
    primary: { ...t.font('ui'), ...t.hud, color: t.colors.accent, fontSize: t.sz('ui', 11) },
    rowSub: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.sub, fontSize: t.sz('ui', 12), marginTop: 2 },
    dot: { ...t.dot(8), backgroundColor: t.colors.sub },
    dotOk: { backgroundColor: t.colors.done, ...t.boxGlow(t.colors.done, 9) },
    dotBad: { backgroundColor: t.colors.blocked, ...t.boxGlow(t.colors.blocked, 9) },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 4 },
    addText: { ...t.font('ui', '600'), color: t.colors.accent, fontSize: t.sz('ui', 14) },
    form: { gap: 8, marginTop: 4 },
    formRow: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
    hint: { ...t.font('ui'), color: t.colors.sub, fontSize: t.px('ui', 13), lineHeight: t.px('ui', 18) },
    mono: { ...t.font('mono'), color: t.colors.text },
    input: {
      ...t.font('mono'),
      color: t.colors.text,
      backgroundColor: t.colors.surface2,
      borderRadius: t.radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: t.sz('code', 14),
      borderWidth: 1,
      borderColor: t.cyber ? alpha(t.colors.accent, 0.3) : 'transparent',
    },
    btn: {
      backgroundColor: t.colors.accent,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: t.radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 120,
    },
    btnDisabled: { opacity: 0.5 },
    btnText: { ...t.font('ui', '700'), color: t.colors.accentInk },
    btnGhost: { paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
    btnGhostText: { ...t.font('ui', '600'), color: t.colors.sub },
    error: { ...t.font('ui'), color: t.colors.blocked, fontSize: t.sz('ui', 13) },
  });

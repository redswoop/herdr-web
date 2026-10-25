/* Folder chooser for the ＋ sheet: walk the host's tree off /api/file (the
   same listing the file viewer shows), tap to descend, one button to pick.
   The path field still takes a typed path — submit jumps there. */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { describeError, shortPath, type FileInfo } from '@herdr/shared';
import { fileInfoUrl } from '../api-urls';
import { alpha, useStyles, useTheme, type Tokens } from '../theme';
import { Icon } from './Icon';

const parent = (p: string) => p.replace(/\/[^/]+\/?$/, '') || '/';
const join = (dir: string, name: string) => `${dir === '/' ? '' : dir}/${name}`;

export function FolderBrowser({
  start,
  host,
  onPick,
  onBack,
}: {
  /** where to open: the folder you'd typed or picked, else ~ */
  start: string;
  host: string | null;
  onPick: (path: string) => void;
  onBack: () => void;
}) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const [dir, setDir] = useState(start || '~');
  const [info, setInfo] = useState<FileInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState(dir);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let gone = false;
    setInfo(null);
    setErr(null);
    fetch(fileInfoUrl(dir, null, host))
      .then(async (r) => {
        const j = (await r.json()) as FileInfo & { error?: string };
        if (gone) return;
        if (!r.ok) setErr(j.error ?? r.statusText);
        else if (j.kind !== 'dir') setErr('not a folder');
        else {
          setInfo(j);
          setEdit(shortPath(j.path));
        }
      })
      .catch((e) => !gone && setErr(describeError(e, host)));
    return () => {
      gone = true;
    };
  }, [dir, host]);

  const here = info?.path ?? null;
  const subs = (info?.entries ?? []).filter((e) => e.dir && (hidden || !e.name.startsWith('.')));
  const dotCount = (info?.entries ?? []).filter((e) => e.dir && e.name.startsWith('.')).length;

  return (
    <View style={styles.root}>
      <View style={styles.top}>
        <Pressable style={styles.back} onPress={onBack} hitSlop={8}>
          <Icon name="back" size={14} color={t.colors.accent} />
          <Text style={styles.backText}>places</Text>
        </Pressable>
        {dotCount > 0 && (
          <Pressable
            style={[styles.dotToggle, hidden && styles.dotToggleOn]}
            onPress={() => setHidden((v) => !v)}
            accessibilityState={{ selected: hidden }}
            accessibilityLabel="show hidden folders"
          >
            <Text style={[styles.dotText, hidden && styles.dotTextOn]}>.* {dotCount}</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.pathRow}>
        <Pressable
          style={styles.up}
          onPress={() => here && here !== '/' && setDir(parent(here))}
          disabled={!here || here === '/'}
          hitSlop={4}
          accessibilityLabel="up one folder"
        >
          <Icon name="chevron-up" size={18} color={here && here !== '/' ? t.colors.accent : t.colors.sub} />
        </Pressable>
        <TextInput
          style={styles.path}
          value={edit}
          onChangeText={setEdit}
          onSubmitEditing={() => edit.trim() && setDir(edit.trim())}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          selectTextOnFocus
        />
      </View>

      {err && <Text style={styles.err}>{err}</Text>}
      {!err && !info && <ActivityIndicator style={styles.spin} color={t.colors.accent} />}
      {info && !subs.length && <Text style={styles.note}>no subfolders</Text>}
      {subs.map((e) => (
        <Pressable key={e.name} style={styles.row} onPress={() => setDir(join(info!.path, e.name))}>
          <Icon name="folder" size={14} color={t.colors.sub} />
          <Text style={styles.name} numberOfLines={1}>
            {e.name}
          </Text>
          <Icon name="chevron-right" size={14} color={t.colors.sub} />
        </Pressable>
      ))}
      {info?.clipped && <Text style={styles.note}>listing clipped at 1000 entries</Text>}

      {here && (
        <Pressable style={styles.pick} onPress={() => onPick(here)}>
          <Icon name="check" size={16} color={t.colors.accent} />
          <Text style={styles.pickText} numberOfLines={1}>
            use {shortPath(here)}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
    root: { gap: 4 },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
    back: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    backText: { color: t.colors.accent, fontSize: t.sz('ui', 12), ...t.font('ui', '700'), ...t.hud },
    dotToggle: {
      borderWidth: 1,
      borderColor: t.cyber ? alpha(t.colors.accent, 0.3) : t.colors.hairline,
      borderRadius: t.radius.sm,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    dotToggleOn: { borderColor: t.colors.accent, backgroundColor: alpha(t.colors.accent, 0.12) },
    dotText: { ...t.font('mono'), color: t.colors.sub, fontSize: t.sz('ui', 11) },
    dotTextOn: { color: t.colors.accent },
    pathRow: { flexDirection: 'row', alignItems: 'stretch', gap: 6, marginBottom: 4 },
    up: {
      width: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: t.radius.sm,
      borderWidth: 1,
      borderColor: t.cyber ? alpha(t.colors.accent, 0.25) : t.colors.hairline,
    },
    path: {
      flex: 1,
      backgroundColor: t.cyber ? alpha('#000000', 0.45) : t.colors.surface,
      borderRadius: t.radius.sm,
      color: t.colors.text,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: t.cyber ? alpha(t.colors.accent, 0.25) : t.colors.hairline,
      ...t.font('mono'),
      fontSize: t.sz('ui', 14),
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: t.glass,
      borderRadius: t.radius.sm,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: t.colors.hairline,
    },
    name: { flex: 1, color: t.colors.text, fontSize: t.sz('ui', 14), ...t.font('ui', '600') },
    note: { ...t.font('ui'), color: t.colors.sub, fontSize: t.sz('ui', 13), paddingVertical: 6 },
    err: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.blocked, fontSize: t.sz('ui', 13), paddingVertical: 6 },
    spin: { paddingVertical: 10 },
    pick: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: 6,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: t.radius.sm,
      borderWidth: 1,
      borderColor: t.colors.accent,
      backgroundColor: alpha(t.colors.accent, 0.12),
    },
    pickText: { color: t.colors.accent, fontSize: t.sz('ui', 14), ...t.font('ui', '700'), ...t.glow(t.colors.accent, 6) },
  });

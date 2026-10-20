import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';
import type { FileInfo } from '@herdr/shared';
import { getPlatform } from '@herdr/shared';
import { fileInfoUrl, fileRawUrl } from '../api-urls';
import { useStyles, useTheme, type Tokens } from '../theme';
import { Icon } from './Icon';
import { MdView } from './MdView';
import { SegText } from './SegText';

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const parent = (p: string) => p.replace(/\/[^/]+\/?$/, '') || '/';
const join = (dir: string, name: string) => `${dir === '/' ? '' : dir}/${name}`;

export function FileViewer({
  path,
  cwd,
  history,
  onClose,
  onNavigate,
  onLoaded,
  onRemoveHist,
}: {
  path: string;
  cwd: string | null;
  history: string[];
  onClose: () => void;
  onNavigate: (path: string) => void;
  onLoaded: (resolvedPath: string) => void;
  onRemoveHist: (path: string) => void;
}) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const [info, setInfo] = useState<FileInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  const [edit, setEdit] = useState(path);
  const [histOpen, setHistOpen] = useState(false);

  useEffect(() => {
    let gone = false;
    setInfo(null);
    setErr(null);
    setRaw(false);
    setEdit(path);
    fetch(fileInfoUrl(path, cwd))
      .then(async (r) => {
        const j = (await r.json()) as FileInfo & { error?: string };
        if (gone) return;
        if (!r.ok) setErr(j.error ?? r.statusText);
        else {
          setInfo(j);
          setEdit(j.path);
          onLoaded(j.path);
        }
      })
      .catch((e) => {
        if (!gone) setErr(String(e));
      });
    return () => {
      gone = true;
    };
  }, [path, cwd, onLoaded]);

  const isMd = /\.(md|markdown)$/i.test(info?.path ?? path);

  // Download to the cache and share the LOCAL file. The raw URL carries
  // ?token= — handing it to the share sheet leaked the daemon's token into
  // whatever the file was shared to.
  const [sharing, setSharing] = useState(false);
  const shareFile = async () => {
    if (!info || sharing) return;
    setSharing(true);
    try {
      const dir = new Directory(Paths.cache, 'share');
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      const name = info.path.split('/').pop() || 'file';
      const dest = new File(dir, name);
      const file = await File.downloadFileAsync(fileRawUrl(info.path, null), dest, {
        idempotent: true,
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { dialogTitle: info.path });
      } else {
        await Share.share({ url: file.uri, message: info.path });
      }
    } catch (e) {
      getPlatform().notifyError(String((e as Error).message ?? e));
    } finally {
      setSharing(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.bar}>
        <Pressable onPress={onClose} hitSlop={10} style={styles.barBtn} accessibilityLabel="close">
          <Icon name="back" size={22} color={t.colors.accent} />
        </Pressable>
        <TextInput
          style={styles.path}
          value={edit}
          onChangeText={setEdit}
          onSubmitEditing={() => edit.trim() && onNavigate(edit.trim())}
          autoCapitalize="none"
          autoCorrect={false}
          selectTextOnFocus
        />
        {info?.kind === 'text' && isMd && (
          <Pressable style={styles.barBtn} onPress={() => setRaw((r) => !r)}>
            <Text style={styles.barBtnText}>{raw ? 'pretty' : 'raw'}</Text>
          </Pressable>
        )}
        {(info?.kind === 'binary' ||
          info?.kind === 'image' ||
          info?.kind === 'video' ||
          info?.kind === 'audio') && (
          <Pressable
            style={styles.barBtn}
            onPress={shareFile}
            disabled={sharing}
            accessibilityLabel="share file"
          >
            {sharing ? (
              <ActivityIndicator size="small" color={t.colors.accent} />
            ) : (
              <Icon name="share" size={18} color={t.colors.accent} />
            )}
          </Pressable>
        )}
        {history.length > 0 && (
          <Pressable
            style={styles.barBtn}
            onPress={() => setHistOpen((o) => !o)}
            accessibilityLabel="file history"
          >
            <Icon name="history" size={18} color={t.colors.accent} />
          </Pressable>
        )}
      </View>

      {histOpen && history.length > 0 && (
        <View style={styles.hist}>
          {history.map((p) => (
            <View key={p} style={styles.histRow}>
              <Pressable
                style={{ flex: 1 }}
                onPress={() => {
                  setHistOpen(false);
                  onNavigate(p);
                }}
              >
                <Text style={styles.histPath} numberOfLines={1}>
                  {p}
                </Text>
              </Pressable>
              <Pressable onPress={() => onRemoveHist(p)} hitSlop={8} accessibilityLabel="remove">
                <Icon name="close" size={16} color={t.colors.sub} />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {err && <Text style={styles.empty}>{err}</Text>}
        {!err && !info && (
          <View style={styles.loading}>
            <ActivityIndicator color={t.colors.accent} />
          </View>
        )}

        {info?.kind === 'text' &&
          (isMd && !raw ? (
            <MdView
              src={info.content ?? ''}
              onOpenFile={(p) =>
                onNavigate(/^[~/]/.test(p) ? p : join(parent(info.path), p))
              }
            />
          ) : (
            <SegText style={styles.pre} selectable text={info.content ?? ''} />
          ))}

        {info?.truncated && (
          <Text style={styles.note}>showing first 512 KB of {fmtSize(info.size)}</Text>
        )}

        {info?.kind === 'image' && (
          <Image
            source={{ uri: fileRawUrl(info.path) }}
            style={styles.img}
            resizeMode="contain"
          />
        )}

        {info?.kind === 'binary' && (
          <Text style={styles.empty}>binary file · {fmtSize(info.size)}</Text>
        )}
        {(info?.kind === 'video' || info?.kind === 'audio') && (
          <View style={styles.mediaBox}>
            <Icon name={info.kind === 'video' ? 'video' : 'audio'} size={28} color={t.colors.sub} />
            <Text style={styles.empty}>
              {info.kind} · {fmtSize(info.size)}
            </Text>
            <Pressable style={styles.mediaBtn} onPress={shareFile} disabled={sharing}>
              <Text style={styles.mediaBtnText}>{sharing ? 'downloading…' : 'share / save'}</Text>
            </Pressable>
          </View>
        )}
        {info?.kind === 'special' && <Text style={styles.empty}>not a regular file</Text>}

        {info?.kind === 'dir' && (
          <View style={styles.dir}>
            {info.path !== '/' && (
              <Pressable style={styles.dirRow} onPress={() => onNavigate(parent(info.path))}>
                <Icon name="folder" size={18} color={t.colors.working} />
                <Text style={styles.dirName}>..</Text>
              </Pressable>
            )}
            {info.entries?.map((e) => (
              <Pressable
                key={e.name}
                style={styles.dirRow}
                onPress={() => onNavigate(join(info.path, e.name))}
              >
                <Icon
                  name={e.dir ? 'folder' : 'file'}
                  size={18}
                  color={e.dir ? t.colors.working : t.colors.sub}
                />
                <Text style={styles.dirName}>
                  {e.name}
                  {e.dir ? '/' : ''}
                </Text>
              </Pressable>
            ))}
            {info.clipped && <Text style={styles.note}>listing clipped at 1000 entries</Text>}
          </View>
        )}
      </ScrollView>

      {info && info.kind !== 'dir' && (
        <Text style={styles.meta}>
          {fmtSize(info.size)} · {new Date(info.mtime).toLocaleString()}
        </Text>
      )}
    </View>
  );
}

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
  root: { flex: 1, backgroundColor: t.colors.bg },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: t.colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.hairline,
  },
  barBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  barBtnText: { color: t.colors.accent, fontSize: 14, ...t.font('ui', '600') },
  path: {
    flex: 1,
    backgroundColor: t.colors.surface2,
    borderRadius: t.radius.sm,
    color: t.colors.text,
    fontSize: 12,
    ...t.font('mono'),
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  hist: {
    backgroundColor: t.colors.surface2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.hairline,
    maxHeight: 180,
  },
  histRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.hairline,
  },
  histPath: { color: t.colors.text, fontSize: 12, ...t.font('mono'), },

  body: { flex: 1 },
  bodyContent: { padding: 14, paddingBottom: 40 },
  loading: { padding: 40, alignItems: 'center' },
  empty: { ...t.font('ui'), color: t.colors.sub, textAlign: 'center', marginTop: 40 },
  pre: {
    ...t.font('mono'),
    color: t.colors.text,
    fontSize: 12,
    lineHeight: 18,
  },
  note: { ...t.font('ui'), color: t.colors.sub, fontSize: 12, marginTop: 12 },
  img: { width: '100%', height: 360, borderRadius: t.radius.md },
  mediaBox: { alignItems: 'center', gap: 10, marginTop: 20 },
  mediaBtn: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: t.r(8),
    borderWidth: 1,
    borderColor: t.colors.accent,
  },
  mediaBtnText: { ...t.font('ui', '600'), color: t.colors.accent, fontSize: 13 },
  dir: { gap: 2 },
  dirRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.hairline,
  },
  dirName: { ...t.font('ui'), color: t.colors.text, fontSize: 15, flex: 1 },
  meta: {
    color: t.colors.sub,
    ...t.font('ui'),
    fontSize: 11,
    padding: 10,
    textAlign: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.colors.hairline,
  },
});

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { FileInfo } from '@herdr/shared';
import { fileInfoUrl, fileRawUrl } from '../api-urls';
import { colors, radius } from '../theme';
import { MdView } from './MdView';

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

  return (
    <View style={styles.root}>
      <View style={styles.bar}>
        <Pressable onPress={onClose} hitSlop={10} style={styles.barBtn}>
          <Text style={styles.barBtnText}>←</Text>
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
        {history.length > 0 && (
          <Pressable style={styles.barBtn} onPress={() => setHistOpen((o) => !o)}>
            <Text style={styles.barBtnText}>🕘</Text>
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
              <Pressable onPress={() => onRemoveHist(p)} hitSlop={8}>
                <Text style={styles.histX}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {err && <Text style={styles.empty}>{err}</Text>}
        {!err && !info && (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent} />
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
            <Text style={styles.pre} selectable>
              {info.content}
            </Text>
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
        {info?.kind === 'special' && <Text style={styles.empty}>not a regular file</Text>}

        {info?.kind === 'dir' && (
          <View style={styles.dir}>
            {info.path !== '/' && (
              <Pressable style={styles.dirRow} onPress={() => onNavigate(parent(info.path))}>
                <Text style={styles.dirIco}>📁</Text>
                <Text style={styles.dirName}>..</Text>
              </Pressable>
            )}
            {info.entries?.map((e) => (
              <Pressable
                key={e.name}
                style={styles.dirRow}
                onPress={() => onNavigate(join(info.path, e.name))}
              >
                <Text style={styles.dirIco}>{e.dir ? '📁' : '📄'}</Text>
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  barBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  barBtnText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  path: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: 12,
    fontFamily: 'monospace',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  hist: {
    backgroundColor: colors.surface2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
    maxHeight: 180,
  },
  histRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  histPath: { color: colors.text, fontSize: 12, fontFamily: 'monospace' },
  histX: { color: colors.sub, paddingLeft: 10 },
  body: { flex: 1 },
  bodyContent: { padding: 14, paddingBottom: 40 },
  loading: { padding: 40, alignItems: 'center' },
  empty: { color: colors.sub, textAlign: 'center', marginTop: 40 },
  pre: {
    fontFamily: 'monospace',
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
  },
  note: { color: colors.sub, fontSize: 12, marginTop: 12 },
  img: { width: '100%', height: 360, borderRadius: radius.md },
  dir: { gap: 2 },
  dirRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  dirIco: { fontSize: 16 },
  dirName: { color: colors.text, fontSize: 15, flex: 1 },
  meta: {
    color: colors.sub,
    fontSize: 11,
    padding: 10,
    textAlign: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
});

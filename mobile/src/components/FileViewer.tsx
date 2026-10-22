import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';
import type { FileInfo } from '@herdr/shared';
import { describeError, getPlatform } from '@herdr/shared';
import { fileInfoUrl, fileRawUrl } from '../api-urls';
import { useStyles, useTheme, type Tokens } from '../theme';
import { Icon } from './Icon';
import { MdView } from './MdView';
import { AudioPlayer, VideoPlayer } from './MediaPlayer';
import { SegText } from './SegText';
import { ZoomImage } from './ZoomImage';

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const parent = (p: string) => p.replace(/\/[^/]+\/?$/, '') || '/';
const join = (dir: string, name: string) => `${dir === '/' ? '' : dir}/${name}`;
// what the server serves as kind 'image' (IMG_MIME)
const IMG_RE = /\.(png|jpe?g|gif|webp|svg|avif|ico|bmp)$/i;

export function FileViewer({
  path,
  cwd,
  history,
  onBack,
  onClose,
  onNavigate,
  onDismissImage,
  onLoaded,
  onRemoveHist,
}: {
  path: string;
  cwd: string | null;
  history: string[];
  /** one step back along the way you came (the previous file card) */
  onBack: () => void;
  /** straight back to the chat, however deep you are */
  onClose: () => void;
  /** `via: 'dir'` when the path was picked from a folder listing */
  onNavigate: (path: string, via?: 'dir') => void;
  /** swipe-down on an image: wherever "back to the folder" is from here */
  onDismissImage?: () => void;
  onLoaded: (resolvedPath: string) => void;
  onRemoveHist: (path: string) => void;
}) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const { width: winW } = useWindowDimensions();
  const [info, setInfo] = useState<FileInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  const [edit, setEdit] = useState(path);
  const [histOpen, setHistOpen] = useState(false);
  // The file this card shows. `path` is fixed for the card's life (every
  // navigation is a new card); only a swipe through sibling images moves it.
  const [cur, setCur] = useState(path);
  const viaSwipeRef = useRef(false);
  // sibling images of an image, for swiping sideways through the folder
  const [gallery, setGallery] = useState<{ dir: string; items: string[] } | null>(null);
  const [galleryH, setGalleryH] = useState(0);
  // a zoomed image owns horizontal drags; the pager waits
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    let gone = false;
    const viaSwipe = viaSwipeRef.current;
    viaSwipeRef.current = false;
    if (!viaSwipe) {
      // a swipe keeps the previous image's info (and the gallery) on screen
      // while the next one's meta loads — no spinner flash between pages
      setInfo(null);
      setErr(null);
      setRaw(false);
    }
    setEdit(cur);
    fetch(fileInfoUrl(cur, cwd))
      .then(async (r) => {
        const j = (await r.json()) as FileInfo & { error?: string };
        if (gone) return;
        if (!r.ok) setErr(j.error ?? r.statusText);
        else {
          setInfo(j);
          setEdit(j.path);
          if (!viaSwipe) onLoaded(j.path); // paging through 40 renders is not 40 history entries
        }
      })
      .catch((e) => {
        if (!gone) setErr(describeError(e));
      });
    return () => {
      gone = true;
    };
  }, [cur, cwd, onLoaded]);

  // an image: list the folder once, keep the images, page through them
  const galleryDir = info?.kind === 'image' ? parent(info.path) : null;
  useEffect(() => {
    if (!galleryDir) return;
    let gone = false;
    fetch(fileInfoUrl(galleryDir, null))
      .then(async (r) => {
        const j = (await r.json()) as FileInfo;
        if (gone || !r.ok) return;
        const items = (j.entries ?? [])
          .filter((e) => !e.dir && IMG_RE.test(e.name))
          .map((e) => join(galleryDir, e.name));
        if (items.length > 1) setGallery({ dir: galleryDir, items });
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [galleryDir]);
  const galleryIdx = gallery ? gallery.items.indexOf(info?.path ?? cur) : -1;
  const galleryActive = !!gallery && galleryIdx >= 0;

  const isMd = /\.(md|markdown)$/i.test(info?.path ?? path);
  // the folder above: a file's own folder, a folder's parent; nothing at /
  const shown = info?.path ?? path;
  const upPath = shown && shown !== '/' && /^[~/]/.test(shown) ? parent(shown) : null;

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
      getPlatform().notifyError(describeError(e));
    } finally {
      setSharing(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.bar}>
        <Pressable onPress={onBack} hitSlop={10} style={styles.barBtn} accessibilityLabel="back">
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
        {upPath && (
          <Pressable
            style={styles.barBtn}
            onPress={() => onNavigate(upPath)}
            hitSlop={6}
            accessibilityLabel="up one folder"
          >
            <Icon name="chevron-up" size={20} color={t.colors.accent} />
          </Pressable>
        )}
        <Pressable onPress={onClose} hitSlop={10} style={styles.barBtn} accessibilityLabel="close, back to chat">
          <Icon name="close" size={22} color={t.colors.accent} />
        </Pressable>
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

      {galleryActive && gallery && (
        <FlatList
          style={styles.body}
          onLayout={(e) => setGalleryH(e.nativeEvent.layout.height)}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          data={gallery.items}
          keyExtractor={(p) => p}
          scrollEnabled={!zoomed}
          initialScrollIndex={galleryIdx}
          getItemLayout={(_, i) => ({ length: winW, offset: winW * i, index: i })}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          windowSize={3}
          onMomentumScrollEnd={(e) => {
            const i = Math.round(e.nativeEvent.contentOffset.x / winW);
            const p = gallery.items[i];
            if (p && p !== cur) {
              viaSwipeRef.current = true;
              setCur(p);
            }
          }}
          renderItem={({ item }) =>
            galleryH > 0 ? (
              <ZoomImage
                uri={fileRawUrl(item)}
                width={winW}
                height={galleryH}
                zoomed={zoomed}
                onZoom={setZoomed}
                onSwipeDown={onDismissImage}
              />
            ) : (
              <View style={{ width: winW, flex: 1 }} />
            )
          }
        />
      )}
      <ScrollView style={[styles.body, galleryActive && styles.hidden]} contentContainerStyle={styles.bodyContent}>
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
            <SegText style={styles.pre} selectable allowFontScaling={false} text={info.content ?? ''} />
          ))}

        {info?.truncated && (
          <Text style={styles.note}>showing first 512 KB of {fmtSize(info.size)}</Text>
        )}

        {info?.kind === 'image' && !galleryActive && (
          <ZoomImage
            uri={fileRawUrl(info.path)}
            width={winW - 28}
            height={360}
            zoomed={zoomed}
            onZoom={setZoomed}
            onSwipeDown={onDismissImage}
          />
        )}

        {info?.kind === 'binary' && (
          <Text style={styles.empty}>binary file · {fmtSize(info.size)}</Text>
        )}
        {info?.kind === 'video' && <VideoPlayer uri={fileRawUrl(info.path)} />}
        {info?.kind === 'audio' && (
          <AudioPlayer uri={fileRawUrl(info.path)} name={info.path.split('/').pop() || info.path} />
        )}
        {(info?.kind === 'video' || info?.kind === 'audio') && (
          <View style={styles.mediaBox}>
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
              <Pressable style={styles.dirRow} onPress={() => onNavigate(parent(info.path), 'dir')}>
                <Icon name="folder" size={18} color={t.colors.working} />
                <Text style={styles.dirName}>..</Text>
              </Pressable>
            )}
            {info.entries?.map((e) => (
              <Pressable
                key={e.name}
                style={styles.dirRow}
                onPress={() => onNavigate(join(info.path, e.name), 'dir')}
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
          {galleryActive && gallery ? `${galleryIdx + 1} / ${gallery.items.length} · ` : ''}
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
  barBtnText: { color: t.colors.accent, fontSize: t.sz('ui', 14), ...t.font('ui', '600') },
  path: {
    flex: 1,
    backgroundColor: t.colors.surface2,
    borderRadius: t.radius.sm,
    color: t.colors.text,
    fontSize: t.sz('ui', 12),
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
  histPath: { color: t.colors.text, fontSize: t.sz('ui', 12), ...t.font('mono'), },

  body: { flex: 1 },
  bodyContent: { padding: 14, paddingBottom: 40 },
  loading: { padding: 40, alignItems: 'center' },
  empty: { ...t.font('ui'), color: t.colors.sub, textAlign: 'center', marginTop: 40 },
  pre: {
    ...t.font('mono'),
    color: t.colors.text,
    fontSize: t.px('code', 12),
    lineHeight: t.px('code', 18),
  },
  note: { ...t.font('ui'), color: t.colors.sub, fontSize: t.sz('ui', 12), marginTop: 12 },
  img: { width: '100%', height: 360, borderRadius: t.radius.md },
  galleryImg: { width: '100%', height: '100%' },
  hidden: { display: 'none' },
  mediaBox: { alignItems: 'center', gap: 10, marginTop: 20 },
  mediaBtn: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: t.r(8),
    borderWidth: 1,
    borderColor: t.colors.accent,
  },
  mediaBtnText: { ...t.font('ui', '600'), color: t.colors.accent, fontSize: t.sz('ui', 13) },
  dir: { gap: 2 },
  dirRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.hairline,
  },
  dirName: { ...t.font('ui'), color: t.colors.text, fontSize: t.sz('ui', 15), flex: 1 },
  meta: {
    color: t.colors.sub,
    ...t.font('ui'),
    fontSize: t.sz('ui', 11),
    padding: 10,
    textAlign: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.colors.hairline,
  },
});

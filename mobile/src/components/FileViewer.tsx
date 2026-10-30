import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
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
import {
  DIR_SORTS,
  describeError,
  dirDesc,
  dirOrderLabel,
  dirOrderQuery,
  fetchPlaces,
  fmtSize,
  fmtStamp,
  formatDirOrder,
  getPlatform,
  mediaSiblings,
  nextDirOrder,
  parseDirOrder,
  togglePin,
  type DirOrder,
  type Places,
} from '@herdr/shared';
import { fileInfoUrl, fileRawUrl } from '../api-urls';
import { alpha, useStyles, useTheme, type Tokens } from '../theme';
import { Icon } from './Icon';
import { MdView } from './MdView';
import { AudioPlayer, VideoPlayer } from './MediaPlayer';
import { SegText } from './SegText';
import { ZoomImage } from './ZoomImage';

// folder sort is a per-device habit; same key as the web client
const ORDER_KEY = 'herdr.dirSort';

const parent = (p: string) => p.replace(/\/[^/]+\/?$/, '') || '/';
const join = (dir: string, name: string) => `${dir === '/' ? '' : dir}/${name}`;

export function FileViewer({
  path,
  cwd,
  host = null,
  history,
  onBack,
  onClose,
  onNavigate,
  onLoaded,
  onRemoveHist,
}: {
  path: string;
  cwd: string | null;
  /** the pane's server id (api.hostOf); null = primary */
  host?: string | null;
  history: string[];
  /** one step back along the way you came (the previous file card) */
  onBack: () => void;
  /** straight back to the chat, however deep you are */
  onClose: () => void;
  onNavigate: (path: string) => void;
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
  // sibling images of an image (videos of a video), for swiping sideways
  // through the folder
  const [gallery, setGallery] = useState<{ dir: string; kind: 'image' | 'video'; items: string[] } | null>(
    null,
  );
  const [galleryH, setGalleryH] = useState(0);
  // the folder whose listing came back (gallery or not): a video waits for it,
  // so its player mounts once, in the pager or alone — a player mounted alone
  // and swapped for the pager's a beat later is released mid-create on Android
  const [listedDir, setListedDir] = useState<string | null>(null);
  // a zoomed image owns drags; the pager holds still
  const [zoomed, setZoomed] = useState(false);
  const [order, setOrder] = useState(() => parseDirOrder(getPlatform().kv.get(ORDER_KEY)));
  const [sortOpen, setSortOpen] = useState(false);
  const saveOrder = (o: DirOrder) => {
    setSortOpen(false);
    setOrder(o);
    getPlatform().kv.set(ORDER_KEY, formatDirOrder(o));
  };

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
    fetch(fileInfoUrl(cur, cwd, host) + dirOrderQuery(order))
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
  }, [cur, cwd, host, onLoaded, order]);

  // an image or a video: list the folder once, keep that kind, page through them
  const galleryKind = info?.kind === 'image' || info?.kind === 'video' ? info.kind : null;
  const galleryDir = galleryKind ? parent(info!.path) : null;
  useEffect(() => {
    if (!galleryDir || !galleryKind) return;
    let gone = false;
    fetch(fileInfoUrl(galleryDir, null, host) + dirOrderQuery(order))
      .then(async (r) => {
        const j = (await r.json()) as FileInfo;
        if (gone) return;
        const items = r.ok ? mediaSiblings(galleryDir, j.entries ?? [], galleryKind) : [];
        if (items.length > 1) setGallery({ dir: galleryDir, kind: galleryKind, items });
        setListedDir(galleryDir);
      })
      .catch(() => !gone && setListedDir(galleryDir));
    return () => {
      gone = true;
    };
  }, [galleryDir, galleryKind, host, order]);
  const galleryIdx = gallery && gallery.kind === galleryKind ? gallery.items.indexOf(info?.path ?? cur) : -1;
  const galleryActive = !!gallery && galleryIdx >= 0;
  // the page on screen: a swipe sets `cur` before its info lands
  const onPage = gallery?.items.includes(cur) ? cur : info?.path;

  // ⌂ the session's project root + the host's pinned folders
  const [places, setPlaces] = useState<Places | null>(null);
  useEffect(() => {
    let gone = false;
    void fetchPlaces(cwd, host).then((p) => !gone && setPlaces(p));
    return () => {
      gone = true;
    };
  }, [cwd, host]);
  const here = info?.kind === 'dir' ? info.path : null;
  const pinned = !!here && !!places?.pins.some((p) => p.path === here);
  const flipPin = async (dir: string) => {
    if (!places) return;
    const pins = await togglePin(places, dir, host);
    if (pins) setPlaces({ ...places, pins });
    else getPlatform().notifyError('could not save pins');
  };
  const leaf = (p: string) => p.split('/').filter(Boolean).pop() || p;

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
      const file = await File.downloadFileAsync(fileRawUrl(info.path, null, host), dest, {
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
            galleryH > 0 && gallery.kind === 'video' ? (
              // one live player, on the page you're on; swiping away unmounts
              // (and so stops) it, the neighbours are just their names
              <View style={[styles.videoPage, { width: winW, height: galleryH }]}>
                {item === onPage ? (
                  <VideoPlayer uri={fileRawUrl(item, null, host)} />
                ) : (
                  <View style={styles.videoNext}>
                    <Icon name="playArrow" size={28} color={t.colors.sub} />
                    <Text style={styles.videoNextName} numberOfLines={1} ellipsizeMode="middle">
                      {item.split('/').pop()}
                    </Text>
                  </View>
                )}
              </View>
            ) : galleryH > 0 ? (
              <ZoomImage
                uri={fileRawUrl(item, null, host)}
                width={winW}
                height={galleryH}
                onZoom={setZoomed}
              />
            ) : (
              <View style={{ width: winW, flex: 1 }} />
            )
          }
        />
      )}
      {info?.kind === 'dir' && (
        // outside the ScrollView so it stays put; the whole sort is one sheet
        // (a fourth column won't fit a phone)
        // places on the left (⌂, pins, ☆ this folder), sort on the right
        <View style={styles.dirHead}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.places} contentContainerStyle={styles.placesRow}>
            {places && (
              <>
                <Pressable
                  style={[styles.place, here === places.home && styles.placeHere]}
                  onPress={() => onNavigate(places.home)}
                  accessibilityLabel="project home"
                  hitSlop={4}
                >
                  <Icon name="home" size={13} color={here === places.home ? t.colors.accent : t.colors.text} />
                </Pressable>
                {places.pins.map((p) => (
                  <Pressable
                    key={p.pin}
                    style={[styles.place, p.path === here && styles.placeHere]}
                    onPress={() => onNavigate(p.path)}
                    onLongPress={() =>
                      Alert.alert(`Unpin ${leaf(p.pin)}?`, p.pin, [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Unpin', style: 'destructive', onPress: () => void flipPin(p.path) },
                      ])
                    }
                    accessibilityLabel={`pinned ${p.pin}`}
                  >
                    <Text style={[styles.placeText, p.path === here && styles.placeTextHere]} numberOfLines={1}>
                      {leaf(p.pin)}
                    </Text>
                  </Pressable>
                ))}
                <Pressable
                  style={styles.pinBtn}
                  onPress={() => here && void flipPin(here)}
                  accessibilityLabel={pinned ? 'unpin this folder' : 'pin this folder'}
                  hitSlop={6}
                >
                  <Icon name={pinned ? 'star' : 'starOutline'} size={16} color={pinned ? t.colors.accent : t.colors.sub} />
                </Pressable>
              </>
            )}
          </ScrollView>
          <Pressable style={styles.sortBtn} onPress={() => setSortOpen(true)} accessibilityLabel="sort" hitSlop={6}>
            <Icon name="sort" size={14} color={t.colors.accent} />
            <Text style={styles.dirSort}>
              {dirOrderLabel(order)}
              {!order.foldersFirst && <Text style={styles.dirCol}> · mixed</Text>}
            </Text>
          </Pressable>
        </View>
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
            uri={fileRawUrl(info.path, null, host)}
            width={winW - 28}
            height={360}
            onZoom={setZoomed}
          />
        )}

        {info?.kind === 'binary' && (
          <Text style={styles.empty}>binary file · {fmtSize(info.size)}</Text>
        )}
        {info?.kind === 'video' && !galleryActive && listedDir === galleryDir && (
          <VideoPlayer uri={fileRawUrl(info.path, null, host)} />
        )}
        {info?.kind === 'audio' && (
          <AudioPlayer uri={fileRawUrl(info.path, null, host)} name={info.path.split('/').pop() || info.path} />
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
                <Text style={styles.dirName} numberOfLines={1} ellipsizeMode="middle">
                  {e.name}
                  {e.dir ? '/' : ''}
                </Text>
                <Text style={styles.dirMeta}>
                  {e.dir ? '' : `${fmtSize(e.size)} · `}
                  {fmtStamp(e.mtime)}
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
      <Modal visible={sortOpen} transparent animationType="fade" onRequestClose={() => setSortOpen(false)}>
        <View style={styles.sheetRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSortOpen(false)} accessibilityLabel="close" />
          <View style={styles.sheet}>
            <Text style={styles.sheetName}>sort</Text>
            {DIR_SORTS.map((s) => {
              const on = order.sort === s.key;
              return (
                <Pressable
                  key={s.key}
                  style={[styles.pick, on && styles.pickOn]}
                  onPress={() => saveOrder(nextDirOrder(order, s.key))}
                  accessibilityLabel={`sort by ${s.label}`}
                >
                  <View style={[styles.pickMark, on && styles.pickMarkOn]} />
                  <Text style={[styles.pickName, on && styles.pickNameOn]}>{s.label}</Text>
                  {/* the current key flips; others show which way they'd start */}
                  <Text style={[styles.pickArrow, on && styles.pickNameOn]}>{dirDesc(order, s.key) ? '↓' : '↑'}</Text>
                </Pressable>
              );
            })}
            <View style={styles.sheetRule} />
            <Pressable
              style={styles.pick}
              onPress={() => saveOrder({ ...order, foldersFirst: !order.foldersFirst })}
              accessibilityRole="switch"
              accessibilityState={{ checked: order.foldersFirst }}
            >
              <Icon name={order.foldersFirst ? 'check' : 'folder'} size={16} color={order.foldersFirst ? t.colors.accent : t.colors.sub} />
              <Text style={[styles.pickName, order.foldersFirst && styles.pickNameOn]}>folders first</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  videoPage: { justifyContent: 'center', paddingHorizontal: 14 },
  videoNext: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    borderRadius: t.r(10),
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  videoNextName: { color: t.colors.sub, fontSize: t.sz('ui', 12), ...t.font('ui'), maxWidth: '80%' },
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
  dirMeta: { ...t.font('ui'), color: t.colors.sub, fontSize: t.sz('ui', 12), fontVariant: ['tabular-nums'] },
  dirHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.hairline,
  },
  places: { flex: 1 },
  placesRow: { alignItems: 'center', gap: 6 },
  place: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    minHeight: 26,
    justifyContent: 'center',
    borderRadius: t.r(13),
    backgroundColor: t.colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.colors.hairline,
    maxWidth: 140,
  },
  placeHere: { borderColor: t.colors.accent },
  placeText: { ...t.font('ui'), color: t.colors.text, fontSize: t.sz('ui', 12) },
  placeTextHere: { color: t.colors.accent },
  pinBtn: { paddingHorizontal: 4, paddingVertical: 4 },
  sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dirSort: { ...t.font('ui', '600'), color: t.colors.accent, fontSize: t.sz('ui', 12) },
  dirCol: { ...t.font('ui'), color: t.colors.sub, fontSize: t.sz('ui', 12) },
  sheetRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    margin: 10,
    marginBottom: 24,
    paddingVertical: 8,
    backgroundColor: t.cyber ? alpha(t.colors.surface2, 0.97) : t.colors.surface2,
    borderRadius: t.radius.md,
    borderWidth: t.cyber ? 1 : StyleSheet.hairlineWidth,
    borderColor: t.cyber ? alpha(t.colors.accent, 0.4) : t.colors.hairline,
    ...t.boxGlow(t.colors.accent, 24, 0.35),
    overflow: 'hidden',
  },
  sheetName: {
    ...t.font(t.cyber ? 'display' : 'ui', '700'),
    ...t.hud,
    fontSize: t.sz('ui', 12),
    color: t.cyber ? t.colors.red : t.colors.accent,
    ...(t.cyber ? t.glow(t.colors.red, 8) : {}),
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 4,
  },
  sheetRule: { height: StyleSheet.hairlineWidth, backgroundColor: t.colors.hairline, marginVertical: 4 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  pickOn: { backgroundColor: alpha(t.colors.accent, 0.1) },
  pickMark: { ...t.dot(8), backgroundColor: alpha(t.colors.sub, 0.3) },
  pickMarkOn: { backgroundColor: t.colors.accent, ...t.boxGlow(t.colors.accent, 8, 0.9) },
  pickName: { ...t.font('mono', '600'), fontSize: t.sz('ui', 15), color: t.colors.text, flex: 1 },
  pickNameOn: { color: t.colors.accent, ...t.glow(t.colors.accent, 6) },
  pickArrow: { ...t.font('mono'), fontSize: t.sz('ui', 15), color: t.colors.sub },
  dirColOn: { color: t.colors.accent },
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

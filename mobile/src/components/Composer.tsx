import { useEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Image,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import {
  agentPath,
  apiUrl,
  errorOf,
  getPlatform,
  post,
  type RestoredDraft,
} from '@herdr/shared';
import { fileRawUrl } from '../api-urls';
import { NeonRail } from '../cyber';
import { RailPacket } from '../cyber-fx';
import { ChamferPlate } from '../cyber-skia';
import { tick } from '../toast';
import { alpha, useStyles, useTheme, type Tokens } from '../theme';
import { Icon } from './Icon';

const KEYS = [
  ['esc', 'Escape'],
  ['↑', 'Up'],
  ['↓', 'Down'],
  ['←', 'Left'],
  ['→', 'Right'],
  ['⏎', 'Enter'],
  ['y', 'y'],
  ['n', 'n'],
  ['^C', 'C-c'],
] as const;

/** One line of composer: the field starts here and grows with the draft up
 *  to ~30% of the window, then scrolls (the web composer's rule). */
const MIN_H = 42;
/** the buttons match the one-line field, so an empty composer is one even row */
const BTN = 42;

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** `path` is the server-side file; null while the upload is in flight. */
type Attachment = {
  id: number;
  path: string | null;
  uri: string;
  kind: 'image' | 'file';
  name?: string;
};
let nextAttId = 1;

const textKey = (paneId: string) => `herdr.textDraft.${paneId}`;
const attKey = (paneId: string) => `herdr.attDraft.${paneId}`;

function loadAtts(paneId: string): Attachment[] {
  try {
    const j = JSON.parse(getPlatform().kv.get(attKey(paneId)) ?? '[]');
    if (!Array.isArray(j)) return [];
    return j
      .map((raw): Attachment | null => {
        if (typeof raw === 'string') {
          return { id: nextAttId++, path: raw, uri: fileRawUrl(raw), kind: 'image' };
        }
        if (raw && typeof raw === 'object' && typeof raw.path === 'string') {
          const kind = raw.kind === 'file' ? 'file' : 'image';
          return {
            id: nextAttId++,
            path: raw.path,
            uri: kind === 'image' ? fileRawUrl(raw.path) : raw.uri ?? '',
            kind,
            name: typeof raw.name === 'string' ? raw.name : undefined,
          };
        }
        return null;
      })
      .filter((a): a is Attachment => !!a);
  } catch {
    return [];
  }
}

function persistAtts(paneId: string, atts: Attachment[]) {
  const payload = atts
    .filter((a) => a.path)
    .map((a) => ({ path: a.path, kind: a.kind, name: a.name }));
  if (payload.length) getPlatform().kv.set(attKey(paneId), JSON.stringify(payload));
  else getPlatform().kv.remove(attKey(paneId));
}

async function uploadBytes(uri: string, mime: string): Promise<string> {
  const src = await fetch(uri);
  if (!src.ok) throw new Error('could not read file');
  const body = await src.arrayBuffer();
  const r = await fetch(apiUrl('/api/upload'), {
    method: 'POST',
    headers: { 'content-type': mime || 'application/octet-stream' },
    body,
  });
  if (!r.ok) throw new Error(await errorOf(r));
  return ((await r.json()) as { path: string }).path;
}

function basename(p: string): string {
  return p.replace(/\/+$/, '').split('/').pop() || p;
}

export function Composer({
  paneId,
  working,
  cooldown,
  restoredDraft,
  showKeys,
  extraKeys,
  onSend,
  onInterrupt,
  onToggleKeys,
  onKeyTap,
}: {
  paneId: string;
  working: boolean;
  cooldown: boolean;
  restoredDraft: RestoredDraft | null;
  showKeys: boolean;
  extraKeys?: readonly [string, string][];
  onSend: (text: string) => Promise<void>;
  onInterrupt: () => void;
  onToggleKeys: () => void;
  onKeyTap?: () => void;
}) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const kv = getPlatform().kv;
  const [text, setTextState] = useState(() => kv.get(textKey(paneId)) ?? '');
  const [atts, setAtts] = useState<Attachment[]>(() => loadAtts(paneId));
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>();
  const [menuOpen, setMenuOpen] = useState(false);
  // Yoga sizes the multiline input to its text on both platforms; pinning a
  // `height` from onContentSizeChange stalls under Fabric (the event reports
  // the frame back). We only track the laid-out height to decide when the
  // field has hit its cap and must scroll internally.
  const [fieldH, setFieldH] = useState(MIN_H);
  const inputRef = useRef<TextInput>(null);
  const { height: winH } = useWindowDimensions();
  const maxH = Math.max(MIN_H, Math.round(winH * 0.3));
  const atCap = fieldH >= maxH - 1;

  const setText = (t: string) => {
    setTextState(t);
    if (t) kv.set(textKey(paneId), t);
    else kv.remove(textKey(paneId));
  };

  const mutateAtts = (pane: string, fn: (cur: Attachment[]) => Attachment[] | null) => {
    setAtts((cur) => {
      const next = fn(cur);
      if (next === null) return cur;
      persistAtts(pane, next);
      return next;
    });
  };

  const prevPane = useRef(paneId);
  useEffect(() => {
    if (prevPane.current === paneId) return;
    prevPane.current = paneId;
    setTextState(kv.get(textKey(paneId)) ?? '');
    setAtts(loadAtts(paneId));
    setSelection(undefined);
    setMenuOpen(false);
  }, [paneId, kv]);

  useEffect(() => {
    if (!restoredDraft) return;
    setTextState((cur) => {
      const next = cur.trim() ? cur : restoredDraft.text;
      if (next) kv.set(textKey(paneId), next);
      else kv.remove(textKey(paneId));
      return next;
    });
    requestAnimationFrame(() => {
      const t = restoredDraft.text;
      setSelection({ start: 0, end: t.length });
      inputRef.current?.focus();
    });
  }, [restoredDraft, paneId, kv]);

  const hasText = !!text.trim();
  const uploading = atts.some((a) => !a.path);
  const hasDraft = hasText || atts.length > 0;
  const stop = !hasDraft && working;

  const enqueueUpload = (
    uri: string,
    mime: string,
    kind: 'image' | 'file',
    name?: string,
  ) => {
    const pane = paneId;
    const id = nextAttId++;
    setAtts((cur) => [...cur, { id, path: null, uri, kind, name }]);
    uploadBytes(uri, mime).then(
      (path) =>
        mutateAtts(pane, (cur) =>
          cur.some((a) => a.id === id)
            ? cur.map((a) => (a.id === id ? { ...a, path } : a))
            : null,
        ),
      (e) => {
        mutateAtts(pane, (cur) =>
          cur.some((a) => a.id === id) ? cur.filter((a) => a.id !== id) : null,
        );
        getPlatform().notifyError(
          `upload failed: ${String((e as Error).message ?? e)}`,
        );
      },
    );
  };

  const pickPhotos = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      getPlatform().notifyError('photo library permission required');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      allowsMultipleSelection: true,
      selectionLimit: 6,
    });
    if (result.canceled || !result.assets?.length) return;
    for (const asset of result.assets) {
      const mime = asset.mimeType ?? 'image/jpeg';
      if (!IMAGE_MIMES.has(mime)) continue;
      enqueueUpload(asset.uri, mime, 'image', asset.fileName ?? undefined);
    }
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      getPlatform().notifyError('camera permission required');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const mime = asset.mimeType ?? 'image/jpeg';
    enqueueUpload(asset.uri, mime, 'image', asset.fileName ?? undefined);
  };

  const pickFiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.length) return;
    for (const asset of result.assets) {
      const mime = asset.mimeType || 'application/octet-stream';
      const kind: 'image' | 'file' = IMAGE_MIMES.has(mime) ? 'image' : 'file';
      enqueueUpload(asset.uri, mime, kind, asset.name);
    }
  };

  const openAttachMenu = () => {
    const keyLabel = showKeys ? 'Hide key pad' : 'Show key pad';
    const run = (action: 'photos' | 'camera' | 'files' | 'keys') => {
      setMenuOpen(false);
      if (action === 'photos') void pickPhotos();
      else if (action === 'camera') void takePhoto();
      else if (action === 'files') void pickFiles();
      else onToggleKeys();
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Photo library', 'Camera', 'Files', keyLabel, 'Cancel'],
          cancelButtonIndex: 4,
          userInterfaceStyle: 'dark',
        },
        (i) => {
          if (i === 0) run('photos');
          else if (i === 1) run('camera');
          else if (i === 2) run('files');
          else if (i === 3) run('keys');
        },
      );
      return;
    }

    // Android / others: in-app sheet (also used as visual fallback)
    setMenuOpen((o) => !o);
  };

  const removeAtt = (id: number) => {
    mutateAtts(paneId, (cur) => cur.filter((a) => a.id !== id));
  };

  const send = async () => {
    const t = text.trim();
    const sending = atts;
    if ((!t && !sending.length) || uploading) return;
    const pane = paneId;
    setText('');
    mutateAtts(pane, () => []);
    setSelection(undefined);
    setMenuOpen(false);
    if (t.startsWith('/')) Keyboard.dismiss();
    const full = [
      t,
      ...sending.map((a) =>
        a.kind === 'file'
          ? `[pasted file: ${a.path}]`
          : `[pasted image: ${a.path}]`,
      ),
    ]
      .filter(Boolean)
      .join('\n');
    try {
      await onSend(full);
    } catch (e) {
      setText(t);
      mutateAtts(pane, () => sending);
      getPlatform().notifyError(String((e as Error).message ?? e));
    }
  };

  const sendKeys = async (key: string) => {
    tick();
    const r = await post(agentPath(paneId, 'keys'), { keys: [key] });
    if (!r.ok) getPlatform().notifyError(await errorOf(r));
    else onKeyTap?.();
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.rail}>
        <NeonRail />
        <RailPacket color={t.colors.accent} period={6500} active={working} />
      </View>
      {atts.length > 0 && (
        <View style={styles.attRow}>
          {atts.map((a) => (
            <View key={a.id} style={[styles.att, !a.path && styles.attUploading]}>
              {a.kind === 'image' ? (
                <Image source={{ uri: a.uri }} style={styles.attImg} />
              ) : (
                <View style={styles.attFile}>
                  <Icon name="file" size={20} color={t.colors.accent} />
                  <Text style={styles.attFileName} numberOfLines={2}>
                    {a.name ? basename(a.name) : 'file'}
                  </Text>
                </View>
              )}
              <Pressable style={styles.attX} onPress={() => removeAtt(a.id)} hitSlop={6}>
                <Icon name="close" size={12} color={t.colors.accentInk} />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {showKeys && (
        <View style={styles.keys}>
          {[...KEYS, ...(extraKeys ?? [])].map(([label, key]) => (
            <Pressable key={key} style={styles.keyBtn} onPress={() => sendKeys(key)}>
              <Text style={styles.keyLabel}>{label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {menuOpen && (
        <View style={styles.menu}>
          <MenuRow
            icon="image"
            label="Photo library"
            onPress={() => {
              setMenuOpen(false);
              void pickPhotos();
            }}
          />
          <MenuRow
            icon="camera"
            label="Camera"
            onPress={() => {
              setMenuOpen(false);
              void takePhoto();
            }}
          />
          <MenuRow
            icon="file"
            label="Files"
            onPress={() => {
              setMenuOpen(false);
              void pickFiles();
            }}
          />
          <MenuRow
            icon="keyboard"
            label={showKeys ? 'Hide key pad' : 'Show key pad'}
            accent={showKeys}
            onPress={() => {
              setMenuOpen(false);
              onToggleKeys();
            }}
          />
        </View>
      )}

      <View style={styles.row}>
        <Pressable
          style={[styles.iconBtn, menuOpen && styles.iconBtnOn]}
          onPress={openAttachMenu}
          onLongPress={() => {
            // long-press: jump straight to key pad (muscle memory)
            setMenuOpen(false);
            onToggleKeys();
          }}
          accessibilityLabel="attach menu"
        >
          <Icon name="attach" size={22} color={menuOpen || showKeys ? t.colors.accent : t.colors.sub} />
        </Pressable>

        <View style={styles.inputWrap}>
          <TextInput
            ref={inputRef}
            style={[styles.input, { maxHeight: maxH }]}
            value={text}
            onLayout={(e) => setFieldH(e.nativeEvent.layout.height)}
            onChangeText={(t) => {
              setText(t);
              setSelection(undefined);
            }}
            placeholder="prompt…"
            placeholderTextColor={t.colors.sub}
            multiline
            scrollEnabled={atCap}
            textAlignVertical="top"
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            selection={selection}
            onSelectionChange={(e) => {
              if (selection) setSelection(e.nativeEvent.selection);
            }}
            blurOnSubmit={false}
            returnKeyType="default"
          />
          {hasText && (
            <Pressable
              style={styles.clear}
              onPress={() => {
                setText('');
                inputRef.current?.focus();
              }}
              accessibilityLabel="clear draft"
            >
              <Icon name="close" size={14} color={t.colors.text} />
            </Pressable>
          )}
        </View>

        <Pressable
          style={[
            styles.send,
            stop && styles.sendStop,
            (stop ? cooldown : !hasDraft || uploading) && styles.sendDisabled,
          ]}
          disabled={stop ? cooldown : !hasDraft || uploading}
          onPress={stop ? onInterrupt : send}
          accessibilityLabel={stop ? 'stop' : 'send'}
        >
          {t.cyber && <ChamferPlate fill={stop ? t.colors.red : t.colors.hot} cut={9} glow={6} />}
          <Icon name={stop ? 'stop' : 'send'} size={18} color={t.colors.accentInk} />
        </Pressable>
      </View>
    </View>
  );
}

function MenuRow({
  icon,
  label,
  onPress,
  accent,
}: {
  icon: 'image' | 'camera' | 'file' | 'keyboard';
  label: string;
  onPress: () => void;
  accent?: boolean;
}) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Pressable style={styles.menuRow} onPress={onPress}>
      <Icon name={icon} size={18} color={accent ? t.colors.accent : t.colors.text} />
      <Text style={[styles.menuLabel, accent && styles.menuLabelOn]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
  wrap: {
    borderTopWidth: t.cyber ? 0 : StyleSheet.hairlineWidth,
    borderTopColor: t.colors.hairline,
    backgroundColor: t.cyber ? alpha(t.colors.bg, 0.84) : t.colors.surface,
    paddingBottom: 8,
    paddingTop: 6,
  },
  rail: { marginTop: -6, marginBottom: 6 },
  attRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  att: {
    width: 56,
    height: 56,
    borderRadius: t.r(10),
    overflow: 'hidden',
    backgroundColor: t.colors.surface3,
  },
  attUploading: { opacity: 0.5 },
  attImg: { width: '100%', height: '100%' },
  attFile: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
    gap: 2,
  },
  attFileName: {
    color: t.colors.sub,
    ...t.font('ui'),
    fontSize: 9,
    textAlign: 'center',
  },
  attX: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 18,
    height: 18,
    borderRadius: t.r(9),
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  keys: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 10,
    paddingBottom: 6,
  },
  keyBtn: {
    backgroundColor: t.cyber ? 'transparent' : t.colors.surface3,
    borderWidth: t.cyber ? 1 : 0,
    borderColor: alpha(t.colors.accent, 0.25),
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: t.radius.sm,
  },
  keyLabel: { color: t.colors.text, fontSize: t.cyber ? 12 : 13, ...t.font('ui', '600'), ...t.hud },

  menu: {
    marginHorizontal: 10,
    marginBottom: 6,
    backgroundColor: t.cyber ? alpha(t.colors.surface2, 0.95) : t.colors.surface2,
    borderRadius: t.radius.md,
    borderWidth: t.cyber ? 1 : StyleSheet.hairlineWidth,
    borderColor: t.cyber ? alpha(t.colors.accent, 0.4) : t.colors.hairline,
    ...t.boxGlow(t.colors.accent, 24, 0.35),
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.hairline,
  },
  menuLabel: { color: t.colors.text, fontSize: 15, ...t.font('ui', '500'), ...(t.cyber ? t.font('mono') : {}) },
  menuLabelOn: { color: t.colors.accent, ...t.glow(t.colors.accent, 8) },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    paddingHorizontal: 8,
  },
  iconBtn: {
    width: BTN,
    height: BTN,
    borderRadius: t.r(BTN / 2),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.cyber ? 'transparent' : t.colors.surface2,
    borderWidth: t.cyber ? 1 : 0,
    borderColor: alpha(t.colors.accent, 0.25),
  },
  iconBtnOn: {
    backgroundColor: alpha(t.colors.accent, 0.18),
    borderColor: t.colors.accent,
  },

  inputWrap: {
    flex: 1,
    position: 'relative',
  },
  input: {
    minHeight: MIN_H,
    backgroundColor: t.cyber ? alpha('#000000', 0.45) : t.colors.surface2,
    borderWidth: t.cyber ? 1 : 0,
    borderColor: alpha(t.colors.accent, 0.25),
    borderRadius: t.radius.md,
    color: t.colors.text,
    ...t.font('input'),
    ...t.phosphor,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    paddingRight: 36,
  },
  clear: {
    position: 'absolute',
    right: 9,
    top: 9,
    width: 24,
    height: 24,
    borderRadius: t.r(12),
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  send: {
    width: BTN,
    height: BTN,
    borderRadius: t.r(BTN / 2),
    backgroundColor: t.cyber ? 'transparent' : t.colors.accent,
    ...(t.cyber ? {} : t.boxGlow(t.colors.hot, 12, 0.6)),
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendStop: { backgroundColor: t.cyber ? 'transparent' : t.colors.blocked },
  sendDisabled: { opacity: 0.4 },
});

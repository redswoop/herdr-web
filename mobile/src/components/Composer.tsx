import { useEffect, useRef, useState } from 'react';
import {
  Image,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
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
import { colors, radius } from '../theme';

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

/** `path` is the server-side file; null while the upload is in flight. */
type Attachment = { id: number; path: string | null; uri: string };
let nextAttId = 1;

const textKey = (paneId: string) => `herdr.textDraft.${paneId}`;
const attKey = (paneId: string) => `herdr.attDraft.${paneId}`;

function loadAtts(paneId: string): Attachment[] {
  try {
    const j = JSON.parse(getPlatform().kv.get(attKey(paneId)) ?? '[]');
    if (!Array.isArray(j)) return [];
    return j
      .filter((p): p is string => typeof p === 'string')
      .map((p) => ({ id: nextAttId++, path: p, uri: fileRawUrl(p) }));
  } catch {
    return [];
  }
}

function persistAtts(paneId: string, atts: Attachment[]) {
  const paths = atts.filter((a) => a.path).map((a) => a.path);
  if (paths.length) getPlatform().kv.set(attKey(paneId), JSON.stringify(paths));
  else getPlatform().kv.remove(attKey(paneId));
}

async function uploadImage(uri: string, mime: string): Promise<string> {
  // RN: arrayBuffer is more reliable than blob for file:// / content:// URIs
  const src = await fetch(uri);
  if (!src.ok) throw new Error('could not read image');
  const body = await src.arrayBuffer();
  const r = await fetch(apiUrl('/api/upload'), {
    method: 'POST',
    headers: { 'content-type': mime },
    body,
  });
  if (!r.ok) throw new Error(await errorOf(r));
  return ((await r.json()) as { path: string }).path;
}

export function Composer({
  paneId,
  working,
  cooldown,
  restoredDraft,
  showKeys,
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
  onSend: (text: string) => Promise<void>;
  onInterrupt: () => void;
  onToggleKeys: () => void;
  onKeyTap?: () => void;
}) {
  const kv = getPlatform().kv;
  const { height } = useWindowDimensions();
  const [text, setTextState] = useState(() => kv.get(textKey(paneId)) ?? '');
  const [atts, setAtts] = useState<Attachment[]>(() => loadAtts(paneId));
  const [inputH, setInputH] = useState(40);
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>();
  const inputRef = useRef<TextInput>(null);

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

  const pickImage = async () => {
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
    const pane = paneId;
    for (const asset of result.assets) {
      const mime = asset.mimeType ?? 'image/jpeg';
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)) continue;
      const id = nextAttId++;
      setAtts((cur) => [...cur, { id, path: null, uri: asset.uri }]);
      uploadImage(asset.uri, mime).then(
        (path) =>
          mutateAtts(pane, (cur) =>
            cur.some((a) => a.id === id)
              ? cur.map((a) => (a.id === id ? { ...a, path } : a))
              : null,
          ),
        (e) => {
          mutateAtts(pane, (cur) => (cur.some((a) => a.id === id) ? cur.filter((a) => a.id !== id) : null));
          getPlatform().notifyError(`image upload failed: ${String((e as Error).message ?? e)}`);
        },
      );
    }
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
    setInputH(40);
    setSelection(undefined);
    if (t.startsWith('/')) Keyboard.dismiss();
    const full = [t, ...sending.map((a) => `[pasted image: ${a.path}]`)]
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
    const r = await post(agentPath(paneId, 'keys'), { keys: [key] });
    if (!r.ok) getPlatform().notifyError(await errorOf(r));
    else onKeyTap?.();
  };

  const maxH = height * 0.3;

  return (
    <View style={styles.wrap}>
      {atts.length > 0 && (
        <View style={styles.attRow}>
          {atts.map((a) => (
            <View key={a.id} style={[styles.att, !a.path && styles.attUploading]}>
              <Image source={{ uri: a.uri }} style={styles.attImg} />
              <Pressable style={styles.attX} onPress={() => removeAtt(a.id)} hitSlop={6}>
                <Text style={styles.attXText}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
      {showKeys && (
        <View style={styles.keys}>
          {KEYS.map(([label, key]) => (
            <Pressable key={key} style={styles.keyBtn} onPress={() => sendKeys(key)}>
              <Text style={styles.keyLabel}>{label}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <View style={styles.row}>
        <Pressable style={styles.iconBtn} onPress={onToggleKeys} accessibilityLabel="toggle key pad">
          <Text style={styles.icon}>⌨</Text>
        </Pressable>
        <Pressable style={styles.iconBtn} onPress={pickImage} accessibilityLabel="attach image">
          <Text style={styles.icon}>🖼</Text>
        </Pressable>
        <View style={styles.inputWrap}>
          <TextInput
            ref={inputRef}
            style={[styles.input, { height: Math.min(Math.max(inputH, 40), maxH) }]}
            value={text}
            onChangeText={(t) => {
              setText(t);
              setSelection(undefined);
            }}
            onContentSizeChange={(e) => setInputH(e.nativeEvent.contentSize.height + 16)}
            placeholder="prompt…"
            placeholderTextColor={colors.sub}
            multiline
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
                setInputH(40);
                inputRef.current?.focus();
              }}
              accessibilityLabel="clear draft"
            >
              <Text style={styles.clearX}>×</Text>
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
          <Text style={styles.sendIcon}>{stop ? '■' : '↑'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    backgroundColor: colors.surface,
    paddingBottom: 8,
    paddingTop: 6,
  },
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
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.surface3,
  },
  attUploading: { opacity: 0.5 },
  attImg: { width: '100%', height: '100%' },
  attX: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attXText: { color: '#fff', fontSize: 12, lineHeight: 14 },
  keys: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 10,
    paddingBottom: 6,
  },
  keyBtn: {
    backgroundColor: colors.surface3,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.sm,
  },
  keyLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    paddingHorizontal: 8,
  },
  iconBtn: {
    width: 36,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 18, color: colors.sub },
  inputWrap: { flex: 1, position: 'relative' },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    paddingRight: 36,
    maxHeight: 200,
  },
  clear: {
    position: 'absolute',
    right: 8,
    top: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearX: { color: colors.text, fontSize: 16, lineHeight: 18 },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendStop: { backgroundColor: colors.blocked },
  sendDisabled: { opacity: 0.4 },
  sendIcon: { color: colors.accentInk, fontSize: 18, fontWeight: '700' },
});

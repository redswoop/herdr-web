import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { MD_LAB_DEFAULT, MdLabContext, MdView, type MdLab } from '../src/components/MdView';
import { BLACK_BOX_REPLY, BLACK_BOX_REPLY_2 } from '../src/lab-fixture';
import { colors } from '../src/theme';

/* Render lab for the iOS empty-bubble bug. The same known-bad reply is drawn
   once per variant, each isolating one suspect; the flat header Text above
   each bubble is the control (flat Texts have never boxed). Whichever variant
   shows glyphs names the cause. Toggle "inverted FlatList" to host the
   variants the way the transcript does, in case the list itself matters. */

const VARIANTS: { id: string; title: string; why: string; lab: Partial<MdLab>; src?: string; press?: boolean }[] = [
  { id: 'g', title: 'G · reply 2, plain View', why: '648-char reply that boxed on a fresh load (code block, 2 long lines)', lab: {}, src: BLACK_BOX_REPLY_2 },
  { id: 'h', title: 'H · reply 2, transcript bubble', why: 'same, inside the Pressable+onLongPress bubble the transcript uses', lab: {}, src: BLACK_BOX_REPLY_2, press: true },
  { id: 'i', title: 'I · reply 1, transcript bubble', why: 'the 3964-char reply inside the transcript bubble', lab: {}, press: true },
  { id: 'asis', title: 'A · as-is', why: 'exactly what the transcript renders', lab: {} },
  { id: 'nobg', title: 'B · no code-span background', why: 'nested Text backgroundColor fragment', lab: { codeBg: false } },
  { id: 'nofont', title: 'C · system font on code spans', why: "fontFamily 'monospace' is not an iOS family", lab: { codeFont: false } },
  { id: 'nolh', title: 'D · no lineHeight', why: 'root Text lineHeight vs nested spans', lab: { lineHeight: false } },
  { id: 'frags', title: 'E · ≤10 spans per Text', why: 'fragment count, not char count', lab: { maxFrags: 10 } },
  { id: 'flat', title: 'F · flattened', why: 'one plain string, no nesting at all', lab: { flatten: true } },
];

function Variant({ v }: { v: (typeof VARIANTS)[number] }) {
  return (
    <View style={styles.variant}>
      <Text style={styles.title}>{v.title}</Text>
      <Text style={styles.why}>{v.why}</Text>
      {v.press ? (
        <Pressable
          style={({ pressed }) => [styles.bubble, pressed && styles.copyPress]}
          onLongPress={() => Clipboard.setStringAsync(v.src ?? BLACK_BOX_REPLY)}
        >
          <MdLabContext.Provider value={{ ...MD_LAB_DEFAULT, ...v.lab }}>
            <MdView src={v.src ?? BLACK_BOX_REPLY} />
          </MdLabContext.Provider>
        </Pressable>
      ) : (
        <View style={styles.bubble}>
          <MdLabContext.Provider value={{ ...MD_LAB_DEFAULT, ...v.lab }}>
            <MdView src={v.src ?? BLACK_BOX_REPLY} />
          </MdLabContext.Provider>
        </View>
      )}
      <Text style={styles.foot}>↑ {v.title} — if the bubble above is blank, this variant did not fix it</Text>
    </View>
  );
}

export default function LabScreen() {
  // deep-link driveable: capra://lab?inv=1&v=nofont (so a Simulator can be
  // stepped through the variants with simctl openurl, no tapping)
  const params = useLocalSearchParams<{ inv?: string; v?: string }>();
  const [inverted, setInverted] = useState(params.inv === '1');
  const [only, setOnly] = useState<string | null>(params.v ?? null);
  useEffect(() => {
    setInverted(params.inv === '1');
    setOnly(params.v && VARIANTS.some((x) => x.id === params.v) ? params.v : null);
  }, [params.inv, params.v]);
  const shown = only ? VARIANTS.filter((v) => v.id === only) : VARIANTS;
  const header = (
    <View style={styles.controls}>
      <Text style={styles.hint}>
        {BLACK_BOX_REPLY.length} chars · the reply that boxed on 2026-10-19. Flat text like this line is the control.
        {' '}params inv={String(params.inv)} v={String(params.v)}
      </Text>
      <View style={styles.row}>
        <Pressable style={[styles.chip, inverted && styles.chipOn]} onPress={() => setInverted((x) => !x)}>
          <Text style={styles.chipText}>inverted FlatList {inverted ? 'on' : 'off'}</Text>
        </Pressable>
        <Pressable style={[styles.chip, !only && styles.chipOn]} onPress={() => setOnly(null)}>
          <Text style={styles.chipText}>all</Text>
        </Pressable>
        {VARIANTS.map((v) => (
          <Pressable key={v.id} style={[styles.chip, only === v.id && styles.chipOn]} onPress={() => setOnly(v.id)}>
            <Text style={styles.chipText}>{v.title.slice(0, 1)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
  if (inverted) {
    // mirrors Transcript.tsx: inverted list, newest first, so the header lands at the bottom
    return (
      <FlatList
        style={styles.root}
        contentContainerStyle={styles.content}
        inverted
        data={[...shown].reverse()}
        keyExtractor={(v) => v.id}
        renderItem={({ item }) => <Variant v={item} />}
        ListFooterComponent={header}
      />
    );
  }
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {header}
      {shown.map((v) => (
        <Variant key={v.id} v={v} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 14, gap: 18 },
  controls: { gap: 8 },
  hint: { color: colors.sub, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface2,
  },
  chipOn: { backgroundColor: colors.accent },
  chipText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  variant: { gap: 6 },
  title: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  why: { color: colors.sub, fontSize: 12 },
  bubble: { borderRadius: 14, padding: 12, backgroundColor: colors.surface },
  copyPress: { opacity: 0.7 },
  foot: { color: colors.sub, fontSize: 11 },
});

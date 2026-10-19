import { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MD_LAB_DEFAULT, MdLabContext, MdView, type MdLab } from '../src/components/MdView';
import { BLACK_BOX_REPLY } from '../src/lab-fixture';
import { colors } from '../src/theme';

/* Render lab for the iOS empty-bubble bug. The same known-bad reply is drawn
   once per variant, each isolating one suspect; the flat header Text above
   each bubble is the control (flat Texts have never boxed). Whichever variant
   shows glyphs names the cause. Toggle "inverted FlatList" to host the
   variants the way the transcript does, in case the list itself matters. */

const VARIANTS: { id: string; title: string; why: string; lab: Partial<MdLab> }[] = [
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
      <View style={styles.bubble}>
        <MdLabContext.Provider value={{ ...MD_LAB_DEFAULT, ...v.lab }}>
          <MdView src={BLACK_BOX_REPLY} />
        </MdLabContext.Provider>
      </View>
      <Text style={styles.foot}>↑ {v.title} — if the bubble above is blank, this variant did not fix it</Text>
    </View>
  );
}

export default function LabScreen() {
  const [inverted, setInverted] = useState(false);
  const [only, setOnly] = useState<string | null>(null);
  const shown = only ? VARIANTS.filter((v) => v.id === only) : VARIANTS;
  const header = (
    <View style={styles.controls}>
      <Text style={styles.hint}>
        {BLACK_BOX_REPLY.length} chars · the reply that boxed on 2026-10-19. Flat text like this line is the control.
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
  foot: { color: colors.sub, fontSize: 11 },
});

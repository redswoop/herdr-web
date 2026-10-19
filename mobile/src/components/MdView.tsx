import { createContext, memo, useContext, useMemo } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { parseMd, type Block, type Inline } from '@herdr/shared';
import { alpha, mix, useStyles, useTheme, type Tokens } from '../theme';
import { chunkFrags, splitInlineSegs, splitPlain } from './segment';

/** Render-lab knobs (app/lab.tsx). Production never provides this context, so
 *  every flag sits at its default and the transcript renders exactly as before.
 *  Each flag isolates one suspect for the iOS empty-bubble bug: a long
 *  span-heavy paragraph draws as a sized, blank box while flat Texts beside it
 *  draw fine. */
export interface MdLab {
  /** inline-code spans keep their backgroundColor (a nested-Text background
   *  fragment is the prime suspect) */
  codeBg: boolean;
  /** inline-code spans use fontFamily 'monospace' (not a real iOS family) */
  codeFont: boolean;
  /** the root Text carries lineHeight */
  lineHeight: boolean;
  /** cap nested spans per root Text; null = only the char/line segmenter */
  maxFrags: number | null;
  /** collapse every paragraph to one plain string in one Text — no nesting,
   *  no onPress, no per-span styles */
  flatten: boolean;
}
export const MD_LAB_DEFAULT: MdLab = {
  codeBg: true,
  codeFont: true,
  lineHeight: true,
  maxFrags: null,
  flatten: false,
};
export const MdLabContext = createContext<MdLab>(MD_LAB_DEFAULT);

// Long paragraphs are split into stacked <Text> segments (see SegText.tsx) —
// one unbounded <Text> past the iOS layer size limit draws as an empty box.
function Inlines({
  nodes,
  onOpenFile,
}: {
  nodes: Inline[];
  onOpenFile?: (path: string) => void;
}) {
  const { maxFrags } = useContext(MdLabContext);
  let segs = splitInlineSegs(nodes);
  if (maxFrags) segs = segs.flatMap((seg) => chunkFrags(seg, maxFrags));
  if (segs.length === 1) return <InlineSeg nodes={segs[0]} onOpenFile={onOpenFile} />;
  return (
    <View>
      {segs.map((seg, i) => (
        <InlineSeg key={i} nodes={seg} onOpenFile={onOpenFile} />
      ))}
    </View>
  );
}

// selectable is OFF in transcript text as of the black-box investigation:
// the empty-bubble rendering matches selectable Text exactly (backgrounds and
// non-selectable siblings draw; selectable glyphs don't), and selectable
// swaps in a different iOS renderer with known blank-rendering bugs under
// RN's new architecture. Copy lives on long-press at the bubble level.
function InlineSeg({
  nodes,
  onOpenFile,
}: {
  nodes: Inline[];
  onOpenFile?: (path: string) => void;
}) {
  const styles = useStyles(makeStyles);
  const lab = useContext(MdLabContext);
  const base = lab.lineHeight ? styles.base : styles.baseNoLh;
  if (lab.flatten) return <Text style={base}>{nodes.map((n) => n.text).join('')}</Text>;
  const code = [styles.code, !lab.codeBg && styles.codeNoBg, !lab.codeFont && styles.codeNoFont];
  return (
    <Text style={base}>
      {nodes.map((n, i) => {
        switch (n.type) {
          case 'text':
            return <Text key={i}>{n.text}</Text>;
          case 'strong':
            return (
              <Text key={i} style={styles.strong}>
                {n.text}
              </Text>
            );
          case 'code':
            return (
              <Text
                key={i}
                style={code}
                onPress={
                  n.href
                    ? () => Linking.openURL(n.href!).catch(() => {})
                    : n.file && onOpenFile
                      ? () => onOpenFile(n.file!)
                      : undefined
                }
              >
                {n.text}
              </Text>
            );
          case 'link':
            return (
              <Text
                key={i}
                style={styles.link}
                onPress={() => Linking.openURL(n.href).catch(() => {})}
              >
                {n.text}
              </Text>
            );
          case 'file':
            return (
              <Text
                key={i}
                style={styles.link}
                onPress={onOpenFile ? () => onOpenFile(n.path) : undefined}
              >
                {n.text}
              </Text>
            );
        }
      })}
    </Text>
  );
}

function BlockView({
  block,
  onOpenFile,
}: {
  block: Block;
  onOpenFile?: (path: string) => void;
}) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  // NO ScrollView in here, ever. Code blocks and tables used to sit in a
  // horizontal ScrollView; under Fabric (RN 0.86) a ScrollView nested in a
  // FlatList cell makes every ancestor View's Yoga height grow on each
  // re-layout (hundreds of thousands of points after a few SSE batches), which
  // draws as the giant empty bubble. Reproduced with app/replay.tsx: removing
  // the ScrollView fixes it; a fixed-height ScrollView, Yoga overflow:scroll on
  // a plain View, inverted off, maintainVisibleContentPosition off, gap→margin
  // all don't. So long code lines wrap and tables are a flex grid.
  if (block.type === 'code') {
    return (
      <View style={styles.codeBlock}>
        {splitPlain(block.text).map((s, i) => (
          <Text key={i} style={styles.codeBlockText}>{s}</Text>
        ))}
      </View>
    );
  }
  if (block.type === 'table') {
    return (
      <View style={styles.tableWrap}>
        <View style={styles.tableRow}>
          {block.header.map((cell, j) => (
            <View key={j} style={styles.th}>
              <Inlines nodes={cell} onOpenFile={onOpenFile} />
            </View>
          ))}
        </View>
        {block.rows.map((row, ri) => (
          <View key={ri} style={styles.tableRow}>
            {row.map((cell, j) => (
              <View key={j} style={styles.td}>
                <Inlines nodes={cell} onOpenFile={onOpenFile} />
              </View>
            ))}
          </View>
        ))}
      </View>
    );
  }
  return <Inlines nodes={block.inlines} onOpenFile={onOpenFile} />;
}

// memo + useMemo are load-bearing here: every SSE batch re-renders the whole
// mounted list, and re-running parseMd on every visible bubble several times
// a second drops frames exactly while the user is typing. `src` is a stable
// string, so memo hits even though parent node objects are rebuilt per batch.
export const MdView = memo(function MdView({
  src,
  onOpenFile,
}: {
  src: string;
  onOpenFile?: (path: string) => void;
}) {
  const styles = useStyles(makeStyles);
  const blocks = useMemo(() => parseMd(src), [src]);
  return (
    <View style={styles.wrap}>
      {blocks.map((b, i) => (
        <View key={i} style={styles.block}>
          <BlockView block={b} onOpenFile={onOpenFile} />
        </View>
      ))}
    </View>
  );
});

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
  wrap: { gap: 6 },
  block: {},
  base: { ...t.font('ui'), color: t.colors.text, fontSize: 15, lineHeight: 22, ...t.phosphor },
  baseNoLh: { ...t.font('ui'), color: t.colors.text, fontSize: 15, ...t.phosphor },
  strong: { ...t.font('ui', '700'), color: t.cyber ? mix(t.colors.text, '#ffffff', 0.5) : t.colors.text, ...t.glow(alpha(t.colors.accent, 0.35), 8) },
  code: {
    ...t.font('mono'),
    backgroundColor: t.cyber ? alpha(t.colors.accent, 0.1) : t.colors.surface3,
    color: t.cyber ? mix(t.colors.accent, t.colors.text, 0.2) : t.colors.accent,
    fontSize: 13,
    ...t.glow(t.colors.accent, 6),
  },
  codeNoBg: { backgroundColor: undefined },
  codeNoFont: { fontFamily: undefined },
  link: { color: t.colors.accent, textDecorationLine: 'underline', ...t.glow(t.colors.accent, 6) },
  codeBlock: {
    backgroundColor: t.cyber ? alpha('#000000', 0.5) : t.colors.surface2,
    borderRadius: t.r(10),
    padding: 10,
    borderWidth: t.cyber ? 1 : 0,
    borderColor: t.colors.hairline,
    borderLeftWidth: t.cyber ? 2 : 0,
    borderLeftColor: t.colors.accent,
  },
  codeBlockText: {
    ...t.font('mono'),
    color: t.colors.text,
    fontSize: 12,
    lineHeight: 18,
  },
  tableWrap: { marginVertical: 4 },
  tableRow: { flexDirection: 'row' },
  th: {
    flex: 1,
    padding: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.colors.hairline,
    backgroundColor: t.glass2,
  },
  td: {
    flex: 1,
    padding: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.colors.hairline,
  },
});

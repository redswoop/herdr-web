import { memo, useMemo } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { parseMd, type Block, type Inline } from '@herdr/shared';
import { colors } from '../theme';
import { splitInlineSegs, splitPlain, wrapLongLines } from './segment';

// Long paragraphs are split into stacked <Text> segments (see SegText.tsx) —
// one unbounded <Text> past the iOS layer size limit draws as an empty box.
function Inlines({
  nodes,
  onOpenFile,
}: {
  nodes: Inline[];
  onOpenFile?: (path: string) => void;
}) {
  const segs = splitInlineSegs(nodes);
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
  return (
    <Text style={styles.base}>
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
                style={styles.code}
                onPress={n.file && onOpenFile ? () => onOpenFile(n.file!) : undefined}
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
  if (block.type === 'code') {
    // horizontal scroll = no wrapping = Text as wide as the longest line, and
    // the iOS layer cap applies to width too — hard-wrap oversized lines first
    return (
      <ScrollView horizontal style={styles.codeBlock} nestedScrollEnabled>
        <View>
          {splitPlain(wrapLongLines(block.text)).map((s, i) => (
            <Text key={i} style={styles.codeBlockText}>{s}</Text>
          ))}
        </View>
      </ScrollView>
    );
  }
  if (block.type === 'table') {
    return (
      <ScrollView horizontal style={styles.tableWrap} nestedScrollEnabled>
        <View>
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
      </ScrollView>
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

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  block: {},
  base: { color: colors.text, fontSize: 15, lineHeight: 22 },
  strong: { fontWeight: '700', color: colors.text },
  code: {
    fontFamily: 'monospace',
    backgroundColor: colors.surface3,
    color: colors.accent,
    fontSize: 13,
  },
  link: { color: colors.accent, textDecorationLine: 'underline' },
  codeBlock: {
    backgroundColor: colors.surface2,
    borderRadius: 10,
    padding: 10,
    maxWidth: '100%',
  },
  codeBlockText: {
    fontFamily: 'monospace',
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
  },
  tableWrap: { marginVertical: 4 },
  tableRow: { flexDirection: 'row' },
  th: {
    minWidth: 80,
    padding: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    backgroundColor: colors.surface2,
  },
  td: {
    minWidth: 80,
    padding: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
});

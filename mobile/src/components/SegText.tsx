import { StyleProp, Text, TextStyle, View } from 'react-native';
import type { Inline } from '@herdr/shared';

/**
 * iOS draws each <Text> into a single layer backing store; past the GPU
 * texture limit (~8192px, ~2700pt at @3x) the layer silently renders as an
 * empty box. Long agent replies, tool results, and file bodies all clear
 * that bar, so no Text in the app may grow unbounded — split at newline
 * boundaries into stacked segments instead. A '\n' is a hard break either
 * way, so the split is visually lossless.
 */
const SEG_LINES = 20;
const SEG_CHARS = 2000;
// a single wrapped line this long would blow the limit on its own
const HARD_CHARS = 6000;

export function splitPlain(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let lines = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') {
      lines += 1;
      if (lines >= SEG_LINES || i - start >= SEG_CHARS) {
        out.push(text.slice(start, i));
        start = i + 1;
        lines = 0;
      }
    } else if (i - start >= HARD_CHARS) {
      out.push(text.slice(start, i));
      start = i;
      lines = 0;
    }
  }
  out.push(text.slice(start));
  return out;
}

/** Split an inline stream at newline boundaries so no segment exceeds the
 *  height cap. Only 'text' nodes can contain '\n' (the inline tokenizer
 *  excludes it from all other node types). */
export function splitInlineSegs(nodes: Inline[]): Inline[][] {
  const segs: Inline[][] = [];
  let cur: Inline[] = [];
  let lines = 0;
  let chars = 0;
  const push = (n: Inline) => {
    cur.push(n);
    chars += n.text.length;
  };
  const flush = () => {
    if (cur.length) segs.push(cur);
    cur = [];
    lines = 0;
    chars = 0;
  };
  for (const n of nodes) {
    if (n.type !== 'text' || !n.text.includes('\n')) {
      push(n);
      continue;
    }
    const parts = n.text.split('\n');
    for (let i = 0; i < parts.length; i += 1) {
      if (i > 0) {
        lines += 1;
        if (lines >= SEG_LINES || chars >= SEG_CHARS) flush();
        else push({ type: 'text', text: '\n' });
      }
      if (parts[i]) push({ type: 'text', text: parts[i] });
    }
  }
  flush();
  return segs.length ? segs : [nodes];
}

export function SegText({
  text,
  style,
  selectable,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  selectable?: boolean;
}) {
  const segs = splitPlain(text);
  if (segs.length === 1) {
    return (
      <Text selectable={selectable} style={style}>
        {text}
      </Text>
    );
  }
  return (
    <View>
      {segs.map((s, i) => (
        <Text key={i} selectable={selectable} style={style}>
          {s}
        </Text>
      ))}
    </View>
  );
}

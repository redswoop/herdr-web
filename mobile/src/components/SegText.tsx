import { StyleProp, Text, TextStyle, View } from 'react-native';
import { splitPlain } from './segment';

// Segmentation logic (why + limits) lives in segment.ts — pure and
// unit-tested. This file is just the plain-text renderer.
export { splitInlineSegs, splitPlain } from './segment';

export function SegText({
  text,
  style,
  selectable,
  allowFontScaling,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  selectable?: boolean;
  /** pass false when `style` already carries px()-scaled sizes (see theme.px) */
  allowFontScaling?: boolean;
}) {
  const segs = splitPlain(text);
  if (segs.length === 1) {
    return (
      <Text selectable={selectable} style={style} allowFontScaling={allowFontScaling}>
        {text}
      </Text>
    );
  }
  return (
    <View>
      {segs.map((s, i) => (
        <Text key={i} selectable={selectable} style={style} allowFontScaling={allowFontScaling}>
          {s}
        </Text>
      ))}
    </View>
  );
}

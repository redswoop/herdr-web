import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';

/** Named glyphs used across the app — maps to Ionicons for crisp, tintable UI. */
export type IconName =
  | 'send'
  | 'stop'
  | 'keyboard'
  | 'image'
  | 'attach'
  | 'camera'
  | 'plus'
  | 'add'
  | 'settings'
  | 'lock'
  | 'share'
  | 'folder'
  | 'file'
  | 'chevron-down'
  | 'chevron-up'
  | 'chevron-right'
  | 'chevron-left'
  | 'chevron-forward'
  | 'chevron-back'
  | 'close'
  | 'history'
  | 'focus'
  | 'list'
  | 'grid'
  | 'back'
  | 'check'
  | 'alert';

const MAP: Record<IconName, keyof typeof Ionicons.glyphMap> = {
  send: 'arrow-up',
  stop: 'stop',
  keyboard: 'keypad-outline',
  image: 'image-outline',
  attach: 'attach-outline',
  camera: 'camera-outline',
  plus: 'add',
  add: 'add-circle-outline',
  settings: 'settings-outline',
  lock: 'lock-closed',
  share: 'share-outline',
  folder: 'folder-outline',
  file: 'document-text-outline',
  'chevron-down': 'chevron-down',
  'chevron-up': 'chevron-up',
  'chevron-right': 'chevron-forward',
  'chevron-left': 'chevron-back',
  'chevron-forward': 'chevron-forward',
  'chevron-back': 'chevron-back',
  close: 'close',
  history: 'time-outline',
  focus: 'locate-outline',
  list: 'list-outline',
  grid: 'grid-outline',
  back: 'chevron-back',
  check: 'checkmark',
  alert: 'alert-circle-outline',
};

export function Icon({
  name,
  size = 20,
  color = colors.sub,
  style,
}: {
  name: IconName;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle | ViewStyle>;
}) {
  return (
    <Ionicons
      name={MAP[name]}
      size={size}
      color={color}
      style={style as TextStyle}
    />
  );
}

/** Circular action button chrome used for FABs and compact toolbars. */
export const iconChrome = StyleSheet.create({
  hit: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

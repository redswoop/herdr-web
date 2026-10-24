/* The skin's motion, from @redswoop/cyberdos/native, plus the two pieces
   that know herdr: a StatusDot that takes an agent status, and the boot log
   branded HERDR//OS with the daemon's host. */
import type { StyleProp, ViewStyle } from 'react-native';
import { getApiConfig } from '@herdr/shared';
import { STATUS_ROLE, herdrBootLines } from '@herdr/shared/cyber';
import { BootLog as CdBootLog, StatusDot as CdStatusDot, type DotTone } from '@redswoop/cyberdos/native';

export { AlarmSweep, Beacon, FlickerIn, Glitch, Pulse, RailPacket, Scramble } from '@redswoop/cyberdos/native';

/** an agent's status dot: blocked flickers, working ticks round */
export function StatusDot({ status, size, color, style }: { status?: string; size?: number; color?: string; style?: StyleProp<ViewStyle> }) {
  const tone: DotTone = (status && STATUS_ROLE[status]) || 'muted';
  return <CdStatusDot tone={tone} size={size} color={color} style={style} />;
}

/** the jack-in boot log, once per cold launch, with the configured server's host */
export function BootLog({ onDone }: { onDone: () => void }) {
  let host: string | null = null;
  try {
    host = new URL(getApiConfig().baseUrl).hostname;
  } catch {}
  return <CdBootLog onDone={onDone} lines={herdrBootLines(host)} />;
}

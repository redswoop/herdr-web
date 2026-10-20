/* Inline playback for video and audio files in the viewer. expo-video gives
   AVPlayer with native controls (byte ranges work out of the box against
   /api/file/raw); expo-audio is a bare player, so the transport is ours. */
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { VideoView, useVideoPlayer } from 'expo-video';
import { alpha, useStyles, useTheme, type Tokens } from '../theme';
import { Icon } from './Icon';

export function VideoPlayer({ uri }: { uri: string }) {
  const styles = useStyles(makeStyles);
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  return (
    <VideoView
      player={player}
      style={styles.video}
      nativeControls
      allowsPictureInPicture
      contentFit="contain"
    />
  );
}

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

export function AudioPlayer({ uri, name }: { uri: string; name: string }) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const player = useAudioPlayer({ uri });
  const status = useAudioPlayerStatus(player);
  useEffect(() => () => player.pause(), [player]);
  const dur = status.duration || 0;
  const pos = status.currentTime || 0;
  const frac = dur > 0 ? Math.min(1, pos / dur) : 0;
  return (
    <View style={styles.audio}>
      <Pressable
        style={styles.play}
        onPress={() => (status.playing ? player.pause() : player.play())}
        accessibilityLabel={status.playing ? 'pause' : 'play'}
      >
        <Icon name={status.playing ? 'pause' : 'playArrow'} size={22} color={t.colors.accentInk} />
      </Pressable>
      <View style={styles.audioBody}>
        <Text style={styles.audioName} numberOfLines={1}>
          {name}
        </Text>
        <Pressable
          style={styles.track}
          onPress={(e) => {
            const w = (e.nativeEvent as unknown as { layout?: { width: number } }).layout?.width;
            if (dur > 0 && w) void player.seekTo((e.nativeEvent.locationX / w) * dur);
          }}
        >
          <View style={[styles.fill, { width: `${frac * 100}%` }]} />
        </Pressable>
        <Text style={styles.time}>
          {fmt(pos)} / {fmt(dur)}
        </Text>
      </View>
    </View>
  );
}

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
    video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: t.r(10) },
    audio: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 12,
      backgroundColor: t.glass,
      borderRadius: t.radius.md,
      borderWidth: t.cyber ? 1 : 0,
      borderColor: alpha(t.colors.accent, 0.3),
    },
    play: {
      width: 44,
      height: 44,
      borderRadius: t.r(22),
      backgroundColor: t.cyber ? t.colors.hot : t.colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
      ...t.boxGlow(t.colors.hot, 12, 0.6),
    },
    audioBody: { flex: 1, gap: 6 },
    audioName: { color: t.colors.text, fontSize: t.sz('ui', 13), ...t.font('ui', '600') },
    track: { height: 6, backgroundColor: alpha(t.colors.accent, 0.15), borderRadius: t.r(3), overflow: 'hidden' },
    fill: { height: '100%', backgroundColor: t.colors.accent, ...t.boxGlow(t.colors.accent, 8, 0.8) },
    time: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.sub, fontSize: t.sz('ui', 11), fontVariant: ['tabular-nums'] },
  });

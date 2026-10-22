/* A photo-viewer image: pinch to zoom, drag to pan while zoomed, double-tap
   to toggle 2.5×, and — at 1× — a vertical drag that lets go of the viewer.
   Reanimated keeps the whole gesture on the UI thread; only the two
   zoomed/dismiss decisions cross to JS. */
import { useEffect } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

const MAX = 6;
const DOUBLE = 2.5;
const SPRING = { damping: 18, stiffness: 180 };

export function ZoomImage({
  uri,
  width,
  height,
  zoomed,
  onZoom,
  onSwipeDown,
}: {
  uri: string;
  width: number;
  height: number;
  /** owner's view of the zoom state (controls the pager's scrollEnabled) */
  zoomed: boolean;
  onZoom: (zoomed: boolean) => void;
  /** a decisive vertical drag at 1× */
  onSwipeDown?: () => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const dropY = useSharedValue(0); // the dismiss drag, separate from zoom panning

  // the owner paged away and back, or the image changed: start flat
  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    tx.value = 0;
    ty.value = 0;
    savedTx.value = 0;
    savedTy.value = 0;
    dropY.value = 0;
  }, [uri, scale, savedScale, tx, ty, savedTx, savedTy, dropY]);

  const clampPan = (s: number, x: number, y: number) => {
    'worklet';
    const mx = Math.max(0, ((s - 1) * width) / 2);
    const my = Math.max(0, ((s - 1) * height) / 2);
    return { x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) };
  };

  const settle = (s: number) => {
    'worklet';
    const next = s < 1.05 ? 1 : Math.min(MAX, s);
    scale.value = withSpring(next, SPRING);
    savedScale.value = next;
    const c = clampPan(next, tx.value, ty.value);
    tx.value = withSpring(c.x, SPRING);
    ty.value = withSpring(c.y, SPRING);
    savedTx.value = c.x;
    savedTy.value = c.y;
    runOnJS(onZoom)(next > 1);
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX * 1.3, Math.max(0.7, savedScale.value * e.scale));
    })
    .onEnd(() => {
      settle(scale.value);
    });

  const pan = Gesture.Pan()
    .enabled(zoomed)
    .minPointers(1)
    .maxPointers(2)
    .onUpdate((e) => {
      const c = clampPan(scale.value, savedTx.value + e.translationX, savedTy.value + e.translationY);
      tx.value = c.x;
      ty.value = c.y;
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (savedScale.value > 1) {
        settle(1);
        return;
      }
      // zoom in around the tapped point
      const s = DOUBLE;
      const x = (width / 2 - e.x) * (s - 1);
      const y = (height / 2 - e.y) * (s - 1);
      const c = clampPan(s, x, y);
      scale.value = withSpring(s, SPRING);
      savedScale.value = s;
      tx.value = withSpring(c.x, SPRING);
      ty.value = withSpring(c.y, SPRING);
      savedTx.value = c.x;
      savedTy.value = c.y;
      runOnJS(onZoom)(true);
    });

  // at 1×: a vertical drag — never a horizontal one, that's the pager's
  const drop = Gesture.Pan()
    .enabled(!zoomed && !!onSwipeDown)
    .activeOffsetY([24, 24])
    .failOffsetX([-16, 16])
    .onUpdate((e) => {
      dropY.value = e.translationY;
    })
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 900) {
        dropY.value = withTiming(height, { duration: 180 });
        if (onSwipeDown) runOnJS(onSwipeDown)();
      } else {
        dropY.value = withSpring(0, SPRING);
      }
    });

  const gesture = Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, drop));

  const style = useAnimatedStyle(() => {
    const d = Math.max(0, dropY.value);
    const shrink = 1 - Math.min(0.25, d / (height * 2));
    return {
      transform: [
        { translateX: tx.value },
        { translateY: ty.value + d },
        { scale: scale.value * shrink },
      ],
      opacity: 1 - Math.min(0.5, d / height),
    };
  });

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={{ width, height }}>
        <Animated.Image source={{ uri }} style={[{ width, height }, style]} resizeMode="contain" />
      </Animated.View>
    </GestureDetector>
  );
}

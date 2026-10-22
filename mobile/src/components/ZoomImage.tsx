/* A photo-viewer image on the platform's own zooming scroll view: pinch to
   zoom (UIScrollView does it), drag to pan while zoomed, double-tap to
   toggle 2.5× around the tap. No gesture library in the loop — the sheet it
   sits in coordinates its swipe-down with a UIScrollView natively, which is
   exactly the interaction a hand-rolled gesture got wrong. Android has no
   scroll-view zoom; there the image just shows. */
import { useRef } from 'react';
import { Image, Pressable, ScrollView, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

const MAX = 6;
const DOUBLE = 2.5;
const TAP_GAP = 280;

export function ZoomImage({
  uri,
  width,
  height,
  onZoom,
}: {
  uri: string;
  width: number;
  height: number;
  /** zoomed in (the pager holds still while true) */
  onZoom: (zoomed: boolean) => void;
}) {
  const ref = useRef<ScrollView>(null);
  const lastTap = useRef(0);
  const zoomed = useRef(false);

  const report = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const z = (e.nativeEvent.zoomScale ?? 1) > 1.01;
    if (z !== zoomed.current) {
      zoomed.current = z;
      onZoom(z);
    }
  };

  const onPress = (e: { nativeEvent: { locationX: number; locationY: number } }) => {
    const now = Date.now();
    const twice = now - lastTap.current < TAP_GAP;
    lastTap.current = now;
    if (!twice) return;
    lastTap.current = 0;
    const sv = ref.current;
    if (!sv) return;
    if (zoomed.current) {
      sv.scrollResponderZoomTo({ x: 0, y: 0, width, height, animated: true });
    } else {
      const w = width / DOUBLE;
      const h = height / DOUBLE;
      sv.scrollResponderZoomTo({
        x: e.nativeEvent.locationX - w / 2,
        y: e.nativeEvent.locationY - h / 2,
        width: w,
        height: h,
        animated: true,
      });
    }
  };

  return (
    <ScrollView
      ref={ref}
      style={{ width, height }}
      contentContainerStyle={{ width, height }}
      minimumZoomScale={1}
      maximumZoomScale={MAX}
      bouncesZoom
      centerContent
      pinchGestureEnabled
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={64}
      onScroll={report}
      onScrollEndDrag={report}
      onMomentumScrollEnd={report}
    >
      <Pressable onPress={onPress} style={{ width, height }}>
        <Image source={{ uri }} style={{ width, height }} resizeMode="contain" />
      </Pressable>
    </ScrollView>
  );
}

/* The web transcript, hosted. One WebView per mounted pane screen showing
   web/src/webview (built into src/tx-bundle.ts by `npm run build:tx`). RN
   owns the socket: this component is a sink for useAgentSession's items and
   a source of taps. Same props as the native <Transcript>, so the pane screen
   swaps one for the other (tx-engine.ts). Contract: web/src/webview/bridge.ts
   and PLAN-HTML-TRANSCRIPT.md §2 — keep V in step with the page's. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { serverFor, type Item } from '@herdr/shared';
import { fontScale, useStyles, useTheme, type Tokens } from '../theme';
import { currentOverrides } from '../prefs';
import { useScrollOnSend } from '../device-prefs';
import { TX_HTML } from '../tx-bundle';
import { tick, toast } from '../toast';

const V = 2;

type PageMsg =
  | { type: 'ready'; v: number }
  | { type: 'openFile'; path: string }
  | { type: 'openUrl'; url: string }
  | { type: 'interrupt' }
  | { type: 'copy'; text: string }
  | { type: 'away'; away: boolean; unseen: boolean }
  | { type: 'gesture'; name: 'flip' }
  | { type: 'log'; level: 'log' | 'warn' | 'error'; msg: string };

export function TxWebView({
  items,
  error,
  loaded,
  working,
  cancellableKey,
  onInterrupt,
  onOpenFile,
  onFlip,
  host = null,
  paneId = '',
}: {
  items: Item[];
  error: string | null;
  loaded: boolean;
  working: boolean;
  cancellableKey: number | null;
  onInterrupt: () => void;
  onOpenFile: (path: string) => void;
  /** the page saw the A/B gesture */
  onFlip?: () => void;
  host?: string | null;
  paneId?: string;
}) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const scrollOnSend = useScrollOnSend();
  const ref = useRef<WebView>(null);
  const [ready, setReady] = useState(false);

  const push = useCallback((msg: object) => {
    // injectJavaScript evaluates, it doesn't parse HTML, so JSON is safe as-is
    ref.current?.injectJavaScript(`window.__tx&&window.__tx.recv(${JSON.stringify(msg)});true;`);
  }, []);

  // theme / text size / server: resent whenever any of it changes
  const init = useMemo(() => {
    const s = serverFor(host);
    return {
      type: 'init',
      v: V,
      theme: t.theme,
      roles: t.cyber ? currentOverrides() : {},
      fs: { chat: t.fonts.chat, code: t.fonts.code },
      fontScale,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      api: { baseUrl: s?.baseUrl ?? '', token: s?.token ?? null },
      paneId,
      host,
      insetBottom: 0, // the composer sits under the transcript; the inset is its
      scrollOnSend,
    };
  }, [t, host, paneId, scrollOnSend]);

  useEffect(() => {
    if (ready) push(init);
  }, [ready, init, push]);

  // two messages, not one: the item list is the expensive push (serialised
  // and re-diffed in the page), and a working/stop/error flip must not
  // re-ship it (2026-11-05 review: hundreds of ms per turn boundary on a
  // multi-MB session)
  useEffect(() => {
    if (ready) push({ type: 'items', items, loaded });
  }, [ready, items, loaded, push]);
  useEffect(() => {
    if (ready) push({ type: 'status', error, working, cancellableKey });
  }, [ready, error, working, cancellableKey, push]);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      let m: PageMsg;
      try {
        m = JSON.parse(e.nativeEvent.data) as PageMsg;
      } catch {
        return;
      }
      switch (m.type) {
        case 'ready':
          if (m.v !== V) toast(`transcript page v${m.v} ≠ app v${V}`);
          setReady(true);
          break;
        case 'openFile':
          onOpenFile(m.path);
          break;
        case 'openUrl':
          void Linking.openURL(m.url).catch(() => toast('could not open link'));
          break;
        case 'interrupt':
          onInterrupt();
          break;
        case 'copy':
          void Clipboard.setStringAsync(m.text).then(() => {
            tick();
            toast('copied');
          });
          break;
        case 'gesture':
          if (m.name === 'flip') onFlip?.();
          break;
        case 'log':
          console[m.level](`[tx] ${m.msg}`);
          break;
        case 'away':
          break; // the status line may want this later
      }
    },
    [onOpenFile, onInterrupt, onFlip],
  );

  return (
    <View style={styles.root}>
      <WebView
        ref={ref}
        source={{ html: TX_HTML }}
        originWhitelist={['*']}
        onMessage={onMessage}
        // the page never navigates: links come out as `openUrl` messages, and
        // anything else trying to load is a bug, not a destination
        onShouldStartLoadWithRequest={(req) => req.url === 'about:blank' || req.url.startsWith('about:srcdoc') || req.url.startsWith('data:')}
        style={[styles.web, { backgroundColor: t.canvas }]}
        containerStyle={{ backgroundColor: t.canvas }}
        setSupportMultipleWindows={false}
        textInteractionEnabled
        allowsLinkPreview={false}
        allowsBackForwardNavigationGestures={false}
        bounces
        overScrollMode="never"
        hideKeyboardAccessoryView
        keyboardDisplayRequiresUserAction
        // no white flash while the page boots
        {...(Platform.OS === 'android' ? { mixedContentMode: 'always' as const, nestedScrollEnabled: true } : {})}
        // safe-area: the page is bottom-anchored by the native composer; the
        // top is under the header. Nothing of the system UI meets it directly.
        contentInsetAdjustmentBehavior="never"
        onError={({ nativeEvent }) => toast(`transcript page: ${nativeEvent.description}`)}
      />
      {!ready && <View style={[StyleSheet.absoluteFill, { backgroundColor: t.canvas }]} pointerEvents="none" />}
      {/* keep the home-indicator inset out of the page: it belongs to the composer */}
      {insets.bottom > 0 && null}
    </View>
  );
}

const makeStyles = (_t: Tokens) =>
  StyleSheet.create({
    root: { flex: 1, minHeight: 0 },
    web: { flex: 1 },
  });

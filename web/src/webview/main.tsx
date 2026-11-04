/* The transcript as a page of its own. Built by vite.webview.config.ts into
 * one self-contained HTML file (mobile/assets/tx/index.html) that Capra
 * hosts in a WebView; served by the dev server at /webview.html with the
 * harness panel for iteration in a browser. See PLAN-HTML-TRANSCRIPT.md. */
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { applyPalette, clearPalette, setSkin } from '@redswoop/cyberdos/web';
import { configureServers } from '@herdr/shared';
import { Transcript } from '../components/Transcript';
import { installBridge, isNative, onHost, send, V, type InitMsg, type StateMsg } from './bridge';
import { installFonts } from './fonts';
import '../style.css';
import '@redswoop/cyberdos/web/cyber.css';
import '../theme-cyber.css';
import './page.css';

const EMPTY: StateMsg = { type: 'state', items: [], loaded: false, error: null, working: false, cancellableKey: null };

function applyInit(m: InitMsg) {
  const root = document.documentElement;
  setSkin(m.theme === 'cyber');
  clearPalette();
  if (m.theme === 'cyber') applyPalette(m.roles);
  // the knob the transcript scales by, times the OS text size
  root.style.setProperty('--fs-chat', String(m.fs.chat * m.fontScale));
  root.style.setProperty('--fs-code', String(m.fs.code));
  root.style.setProperty('--inset-bottom', `${m.insetBottom}px`);
  root.dataset.platform = m.platform;
  configureServers([{ id: '', name: '', baseUrl: m.api.baseUrl, token: m.api.token }]);
}

function Page() {
  const [init, setInit] = useState<InitMsg | null>(null);
  const [st, setSt] = useState<StateMsg>(EMPTY);
  const [bad, setBad] = useState<string | null>(null);
  const scrollEnd = useRef<(() => void) | null>(null);

  useEffect(
    () =>
      onHost((m) => {
        if (m.type === 'init') {
          if (m.v !== V) setBad(`bridge v${m.v} ≠ page v${V}`);
          applyInit(m);
          setInit(m);
        } else if (m.type === 'state') setSt(m);
        else if (m.type === 'scrollEnd') scrollEnd.current?.();
      }),
    [],
  );

  // http(s) links: the host decides what opens them (Safari/Chrome via Linking
  // on the phone, a new tab in the harness) — the page itself never navigates
  useEffect(() => {
    const on = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
      if (!a) return;
      e.preventDefault();
      send({ type: 'openUrl', url: a.href });
    };
    document.addEventListener('click', on);
    return () => document.removeEventListener('click', on);
  }, []);

  return (
    <>
      {bad && <div className="tx-skew">{bad}</div>}
      <Transcript
        items={st.items}
        error={st.error}
        loaded={st.loaded}
        working={st.working}
        cancellableKey={st.cancellableKey}
        onInterrupt={() => send({ type: 'interrupt' })}
        onOpenFile={(path) => send({ type: 'openFile', path })}
        onAway={(away, unseen) => send({ type: 'away', away, unseen })}
        host={init?.host ?? null}
        scrollEndRef={scrollEnd}
        scrollOnSend={init?.scrollOnSend ?? true}
      />
    </>
  );
}

// two fingers down twice inside 450 ms: the engine flip (mobile/src/tx-engine.ts
// does the same for the native transcript, so the gesture means one thing)
let lastPair = 0;
document.addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length !== 2) return;
    const now = Date.now();
    if (now - lastPair < 450) {
      lastPair = 0;
      send({ type: 'gesture', name: 'flip' });
    } else lastPair = now;
  },
  { passive: true },
);

installBridge();
installFonts();
createRoot(document.getElementById('root')!).render(<Page />);

if (isNative()) {
  // page errors are invisible in a WebView: forward them to Metro
  window.addEventListener('error', (e) => send({ type: 'log', level: 'error', msg: String(e.message) }));
  send({ type: 'ready', v: V });
} else {
  void import('./harness').then((h) => h.mountHarness());
}

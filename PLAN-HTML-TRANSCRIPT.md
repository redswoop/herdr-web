# PLAN-HTML-TRANSCRIPT — one HTML transcript for web and Capra

Armen's call, 2026-11-04: the transcript (and the markdown file viewer) become a
single HTML/CSS/JS surface that web renders in-page and Capra renders in a
WebView. One shared codebase owns virtualization, scrolling, selection and
markup. Native stays native for everything around it: header, status line,
blocked/ask cards, composer, keyboard, file viewer chrome, screen mirror.

Markdown parsing moves to the server (MD files first, conversations second).
The phone ends up a dumb painter. The watch stays SwiftUI — watchOS has no
WebView — and keeps its lite transcript; nothing here touches `watch/`.

Both engines coexist until the A/B says the native one goes. A trivial
gesture flips between them on the fly on the same pane.

## 0. What exists (the seams)

- `web/src/components/Transcript.tsx` (525 lines) is already a pure component:
  `items, error, loaded, working, cancellableKey → onInterrupt, onOpenFile`.
  AgentView keeps BlockedCard / RewindCard / Composer outside it. Delegated
  click handler on `a[data-file]` and `code/strong/pre` chips.
- `shared/src/transcript.ts` builds the node tree (`buildNodes`: items →
  bubbles, tool groups, meta footer, command pills, files cards). Both
  clients consume it.
- `shared/src/md/parse.ts` + `render-html.ts`: the markdown parser and the
  HTML renderer (`md(src, {image})`). Web uses them; Capra uses the parser and
  draws with `MdView.tsx` (415 lines) + `SegText`/`segment.ts`.
- `mobile/src/components/Transcript.tsx` (810 lines): the FlatList twin, with
  the Fabric workarounds (no nested ScrollView, SEG_CHARS splitting, px()
  Dynamic Type rule, mdIsWide shrink-wrap tables).
- `mobile/app/agent/[paneId]/index.tsx`: `KeyboardAvoidingView > [header,
  blocked banner, Transcript, cards, LiveTail, Composer]`. `useAgentSession`
  (shared hook) feeds `items` from the SSE stream with per-pane memory.
- `lib/transcript-window.js`: server clips tool results at 20k chars and
  windows history (`tail`, `older`). Payloads are already phone-sized.
- `web/src/style.css` + `theme-cyber.css` hold the transcript CSS;
  `mobile/src/theme-map.ts` holds the same roles as RN tokens.
- Lab infra on the phone: `mobile/app/lab.tsx` (static fixtures) and
  `mobile/app/replay.tsx` (replays a real pane through the real Transcript).
- `react-native-webview` is not a dependency yet (lockfile mentions it only
  as a peer of something).

## 1. Architecture

```
            web/src/components/Transcript.tsx  (+ style.css, theme-cyber.css)
            the one transcript. No fetch, no socket. Props in, taps out.
                     │                                │
        web/src/main.tsx (the app)        web/src/webview/main.tsx (the page)
        React props                       bridge.ts: window.__tx.recv(msg) in,
                                          ReactNativeWebView.postMessage out;
                                          harness.tsx stands in for RN in a
                                          browser (/webview.html on the dev server)
                                                │
                                   vite.webview.config.ts → one html file
                                   (React + CSS + fonts inlined), then
                                   scripts/tx-bundle.mjs → mobile/src/tx-bundle.ts
                                   (a string export; generated, gitignored,
                                   root `postinstall` rebuilds it)
                                                │
                                   Capra <TxWebView> (react-native-webview,
                                   source={{html}}): RN owns the socket,
                                   pushes items in, receives taps out.
```

Why not a shared package: `shared/` deliberately compiles without the DOM
lib (its tsconfig says so), and the only DOM consumers are web and the page,
so the page is a second vite entry inside `web/`. The watch is SwiftUI and
never wanted this. (Decided 2026-11-04 while building phase 1.)

Rules:

- RN owns the connection. The WebView never talks to the server itself.
  `useAgentSession` stays where it is; `TxWebView` is a sink for its `items`.
  Same component, same props on web, so parity is structural.
- The bridge is small and versioned. Anything that needs native (clipboard,
  share sheet, haptics, open file, interrupt, load older) crosses it as a
  message. Anything that is "just rendering" never does.
- Server-side render is a second step layered on the same component: the
  component accepts either raw `TEvent.text` (parses locally) or a
  pre-rendered `ev.html` (paints it). Flip per event, so the live tail can
  stay raw while closed turns arrive rendered.
- One WebView per *mounted* pane screen. expo-router keeps stack screens
  mounted, so off-screen panes drop their WebView (render a snapshot height
  placeholder) and restore scroll on return.

## 2. Bridge protocol

RN → page, via `injectJavaScript('window.__tx.recv(' + JSON + ')')`:

| msg | payload | when |
| --- | --- | --- |
| `init` | `{v, theme, roles, fs, fontScale, platform, paneId, host}` | first `ready`; theme/text-size changes resend it |
| `state` | `{items, loaded, error, working, cancellableKey, older, loadingOlder}` | every change of the Transcript props (v1: whole items array; v2: `{append, replaceTail}` deltas) |
| `scrollEnd` | `{}` | composer send, "new" pill tap |
| `fileMd` | `{path, src \| html, imageBase}` | file viewer mode |

Page → RN, via `window.ReactNativeWebView.postMessage(JSON)`:

| msg | payload | native action |
| --- | --- | --- |
| `ready` | `{v}` | send `init` + `state` |
| `openFile` | `{path}` | existing `onOpenFile` → file screen |
| `interrupt` | `{}` | existing `interrupt` |
| `loadOlder` | `{}` | existing `loadOlder` |
| `copy` | `{text}` | expo-clipboard + `tick()` toast |
| `quote` | `{text}` | `quoteIntoComposer` |
| `share` | `{text}` | RN `Share` / ActionSheet (replaces native long-press menu) |
| `away` | `{away, unseen}` | the "new ↓" pill lives in the page; RN only needs it for the status line |
| `haptic` | `{kind}` | expo-haptics |
| `log` | `{level, msg}` | forwards page console to Metro (debug only) |

`v` on both sides; the page refuses a mismatched `init` loudly (red bar) so
OTA bundle vs native skew is obvious, never silent.

## 3. Phases

Each phase ends with something you can look at on the phone and on
`stormer:5174`. The A/B toggle lands in phase 2 and stays until phase 6.

### Phase 1 — lift the web transcript into a shared package  ✅ 2026-11-04 (as a web/ entry, see §1)

- Move `web/src/components/Transcript.tsx` + the transcript/md CSS it needs
  into `shared/src/tx/` as `@herdr/shared/tx` (React + DOM, no web-app
  imports: `copyText`, `md` come along; `Item` types already shared).
- CSS: pull `.transcript`, `.msg`, `.step*`, `.turn-meta`, `.md-table`,
  `.file-md`, `.files-card`, the code/chip styles, and the cyber overrides
  into `shared/src/tx/tx.css` + `tx-cyber.css`, driven only by CSS variables
  (`--bg --fg --sub --accent --live --alarm --surface-2 --fs --font-ui
  --font-mono --font-display`). Web keeps setting those on `:root` as today.
- Web imports the component from shared. Zero behaviour change. e2e suite
  green (port overrides!) is the gate.
- Add a `shared/src/tx/bridge.ts`: a tiny store (`recv(msg)`, `subscribe`)
  and a `send(msg)` seam that web never uses but the webview entry does.

Size: a day. Risk: CSS entanglement with the rest of `style.css`.

### Phase 2 — the webview bundle, the Capra engine switch, the A/B gesture  (built 2026-11-04, unverified on a device)

- `webview/` workspace: vite + `vite-plugin-singlefile`, entry `main.tsx`
  mounts `<Transcript>` fed by the bridge store. Fonts (Chakra Petch, Share
  Tech Mono, Orbitron) inlined as base64 `@font-face`. Output:
  `mobile/assets/tx/index.html` (committed, rebuilt by `npm run build:tx`;
  `build:web` depends on it so a bounce can't ship a stale bundle).
- Dev harness: `webview/index.html` served by vite with a fake bridge that
  loads fixtures (`replay`-style: a real pane's events via `/api` proxy, or a
  JSON fixture) and lets you fire `state` updates from a side panel. This is
  where 90 % of iteration happens; Playwright can drive it headless.
- Capra: add `react-native-webview` (native dep: pod install on the Mac,
  Podfile.lock two-line dance, Android gradle, bump app.json `version` so
  old builds don't get the new JS). Local Android build on the API-36
  emulator first, it's free. iOS native builds go **local on blackstar**
  (`eas build --local` + `eas submit`, recipe in the capra-ota-updates memory:
  fresh clone in ~/dev/capra-build, system bins before Homebrew on PATH), not
  through EAS quota.
- `mobile/src/components/TxWebView.tsx`: loads the bundled html via
  `expo-asset` → `file://` with `allowFileAccess`, `originWhitelist=['*']`,
  `textInteractionEnabled`, `overScrollMode=never`, dark `backgroundColor`
  from tokens (no white flash), `setSupportMultipleWindows=false`. Props are
  exactly the native Transcript's props; it serialises them into `state`.
- Engine switch: `device-prefs` key `tx.engine: 'native' | 'html'`,
  default `native`. The pane screen renders one or the other.
- **The gesture:** two-finger double-tap anywhere on the transcript. Each
  engine detects it on its own side (RN can't reliably see touches inside a
  WebView, the page can't see RN's): `twoFingerDoubleTap` in
  `mobile/src/tx-engine.ts` on a View around the native transcript, a
  `touchstart` listener in `web/src/webview/main.tsx` that reports
  `gesture: flip` over the bridge. Flip, haptic, toast reading `HTML
  transcript` / `native transcript`. Same switch in Settings → transcript.
  Scroll position resets to bottom on flip; that's fine for A/B.
- Keyboard: TxWebView sits in the same `KeyboardAvoidingView` slot. The page
  pins to bottom on resize when `follow` is true (the web logic already does
  this; verify it under a keyboard-driven shrink).
- Dynamic Type + the text-size knobs: `init.fontScale * fs` → `html {
  font-size }`. The px() rule and `allowFontScaling=false` have no
  equivalent here; the page just scales.

Go/no-go after this phase, on the real phone at Extra Large text:

- scroll feel (fling, rubber-band, momentum) vs the FlatList;
- keyboard open/close keeps the tail pinned, no jump, no white flash;
- a streaming turn (replay) doesn't stutter;
- selection + copy of a paragraph works, chips still tap;
- cold open of a pane (WebView spin-up) feels no worse than today. If it
  does, pre-warm one hidden WebView at app boot.

Size: two or three days including the native build loop.

### Phase 3 — parity pass on the html engine (phone-only behaviours)

Things the native Transcript does that the web one doesn't yet, moved into
the shared component behind `platform === 'ios' | 'android'`:

- long-press bubble → `share` message (copy / quote / share sheet);
- `older` / `loadOlder` affordance at the top (web has no history paging);
- `files` card tap → `openFile`; image chips → `openFile` (native viewer);
- the `away`/unseen pill as a page element, haptic on arrival;
- the `cancellable` tap-to-stop on the mine bubble → `interrupt`;
- 44 pt tap targets, safe-area bottom inset passed in `init`.

Plus memory: unmount WebViews of non-top pane screens, keep a height
placeholder, restore scroll on return.

Size: a day or two. This is where the A/B toggle earns its keep.

### Phase 4 — server renders markdown files

- `GET /api/file?path=…&render=md` returns `{…FileInfo, html}` built with the
  shared `md()` and a proper `image` resolver (knows cwd, checks existence,
  adds `width/height` for local images so layout doesn't jump). Cache on
  `(path, mtime, size)` in memory. Chunked for big files: `?render=md&chunk=N`
  returns block ranges; the page appends on scroll (`content-visibility:
  auto` does the rest; real DOM windowing only above ~20k blocks).
- Web FileViewer: use `html` when present instead of calling `md()` locally.
- Capra FileViewer: markdown branch becomes a `TxWebView` in `fileMd` mode.
  Non-md kinds (image, video, audio, dir, raw) stay native.
- Keep the client parser for one release as a fallback when a node is
  older than the client (multi-host: blackstar may lag stormer).

Size: a day.

### Phase 5 — server renders conversation turns

- SSE and `/api/agent/:pane/transcript` grow `?fmt=html`: every
  `assistant`/`user`/`thought`/`tool_result` event that is *closed* carries
  `html` (rendered with the same `md()`, `data-key` attributes for
  interaction). Steps' `stepSummary`/`stepFile` move server-side into the
  same payload (`summary`, `file`), so the clients stop re-deriving them.
- The live tail: events of the open turn stream as raw `text` exactly as
  today; when the turn closes the server re-sends the final event with
  `html`, and the component swaps. No incremental markdown on the server.
- The shared Transcript prefers `ev.html` and falls back to local `md()`
  for raw/old-node events. Same component, no fork.
- Cache rendered events per session file alongside the window cache.
- Measure: bytes per turn over the socket before/after (gzip is on), first
  paint of a 300-event pane on cellular.

Size: a day or two. Server tests in `test/` for the html field and the
tail swap.

### Phase 6 — retire the native engine

Only once the A/B has been living in `html` for a week without reaching for
the gesture:

- delete `mobile/src/components/MdView.tsx`, `SegText.tsx`, `segment.ts`,
  `lab.tsx`, `lab-fixture.ts`, the native `Transcript.tsx`, the md branch of
  the Capra FileViewer; `replay.tsx` stays but drives TxWebView.
- drop `tx.engine`, the gesture, the Settings switch.
- memory notes: `ios-text-layer-limit`, `ios-dynamic-type-clip`,
  `yoga-shrink-wrap-tables`, `md-images-doc-list`, `md-emphasis-segmenter`
  become history.
- the client-side parser stays in shared for the live tail and for the
  stale-node fallback only.

## 4. Things to decide as they come (defaults chosen)

- **Single-file bundle vs asset dir.** Single file, fonts inlined (~350 KB).
  WKWebView file-access rules make a directory of assets fiddly under Expo;
  one file sidesteps it and rides expo-updates as an asset.
- **React in the WebView.** Yes. It's the same component; 45 KB gz is
  nothing next to the fonts. No second renderer to maintain.
- **State payload v1 = whole items array** on each change. Server windows
  already bound it; a 2 k-item window is ~1 MB serialised and that's the
  pathological case. Deltas in v2 only if profiling says so.
- **Selection menu.** WebView's own (Copy / Look Up / Share). The native
  long-press share menu moves to the page as `share`. If WKWebView's menu
  feels wrong in cyber skin, `menuItems` on the WebView customises it.
- **Android.** Chrome WebView; test on the emulator each phase, and once on
  a real device before phase 6. Vendor WebViews are the one thing we can't
  control.
- **Links to http(s).** `onShouldStartLoadWithRequest` blocks all navigation;
  http links go out through a `openUrl` message to `expo-linking`.

## 5. Order of work for the first session

1. Phase 1 lift + e2e green. Commit.
2. `webview/` bundle + dev harness in a browser with a replayed pane. Commit.
3. `react-native-webview` in, Android emulator build, TxWebView on a pane
   with the engine switch + gesture. `[build]` commit for TestFlight.
4. Keyboard and scroll tests on the phone. Go/no-go.

# herdr mobile — React Native + Expo iOS client sharing the herdr-web core

## Context

Armen wants a native iOS app doing everything the webui does. Decision (after comparing SwiftUI / RN / Capacitor): **React Native + Expo, managed workflow** — it reuses the hard-won TypeScript logic layer nearly verbatim and keeps the dev loop on Linux (Expo Go on iPhone over the tailnet; Mac/EAS only for release builds and Phase-3 push). Phased: P1 core (roster, transcript, composer, blocked answering, live tail, interrupt, token auth), P2 (file viewer, launcher/worktrees, image attach, screen mirror, group-by/overview), P3 (APNs push via expo-notifications + server work in `lib/notify.js`, polish).

**Why reuse is high**: the three server-state hooks (`web/src/hooks/useRoster.ts`, `useAgentSession.ts`, `useBlockedContext.ts`, ~500 lines) encode every hard-won invariant — own-loop SSE reconnect that never resumes a stale `?offset=` (the duplicate-transcript bug), 20s/30s zombie watchdogs, foreground/online rebuild, optimistic-send reconciliation, interrupt salvage/divider/C-c-after-700ms, blocked `{keys, expect}` + 409 fallback. Verified by grep: their ONLY browser touchpoints are `EventSource`, `document.visibilityState`/`visibilitychange`, `window 'online'`, and `alert()`. Everything else is React + fetch + timers. Auth: `?token=` on any request (incl. SSE) authenticates (`server.js:886-899`) — RN ignores cookies entirely.

## Monorepo restructure (npm workspaces)

Root `package.json` (NEW): `{ "private": true, "workspaces": ["web", "mobile", "shared"] }`. `server.js`/`lib/`/`public/` untouched — the zero-dep daemon never resolves from node_modules (verify `node server.js` + systemd still fine).

```
shared/                      # @herdr/shared — ships raw TS source, no build step
  tsconfig.json              # "lib": ["ES2022"] — NO DOM: compiler enforces the seam
  src/
    types.ts                 # moved verbatim from web/src/types.ts
    api.ts                   # adapted: configureApi({baseUrl, token}) + apiUrl(path) appends ?token=; post/errorOf/agentPath keep signatures
    platform.ts              # NEW adapter interface + setPlatform()
    spawn.ts                 # moved; localStorage → platform.kv
    session-reducer.ts       # NEW: applyEvents/insertSorted/claimAt extracted from useAgentSession as pure reducer
    transcript.ts            # buildNodes + stepSummary/stepFile/fmtDur/fmtTok/firstLine/clip (Transcript.tsx:32-138, 451-529)
    chrome.ts                # stripChrome + TAIL_CHROME_RES (LiveTail.tsx:8-38), isTuiChrome (AgentView.tsx:16-27), chromeVisible (ScreenMirror.tsx:6-15)
    roster-groups.ts         # buildGroups/splitByTab/dominant (Sidebar.tsx:41-166), cleanAgentName (NewChatDialog.tsx:27-34)
    md/parse.ts              # AST parser (below); md/render-html.ts — HTML serializer for web parity
    hooks/useRoster.ts, useAgentSession.ts, useBlockedContext.ts   # moved, ported to platform adapter — logic byte-for-byte otherwise
web/                         # keeps working identically
  src/types.ts, spawn.ts, hooks/*  → one-line re-export shims (no component import churn)
  src/platform.web.ts        # web adapter, registered in main.tsx
mobile/                      # NEW Expo app (expo-router template)
```

**Platform seam** (`shared/src/platform.ts`), sized to exactly the grepped touchpoints:
- `openSse(url): SseClient` (addEventListener for named events, onopen/onerror, isClosed(), close())
- `kv: {get/set/remove}` **sync** — web: localStorage; RN: in-memory Map hydrated from AsyncStorage before root UI mounts, write-through
- `onWake(cb): unsubscribe` — web: visibilitychange+online; RN: AppState 'active' + NetInfo reconnect
- `isForeground()`, `notifyError(msg)` (alert / Alert.alert)

Hook port is mechanical: `new EventSource(url)` → `platform.openSse(apiUrl(url))`, visibility guards → `platform.isForeground()`, etc. Reconnect loops, gen-bump reload-on-error, watchdog intervals, 700ms C-c, 2.5s retry — unchanged. Web calls `configureApi({baseUrl:'', token:null})` (cookie path, zero behavior change).

**Vite/tsconfig**: shared ships raw TS → `optimizeDeps.exclude: ['@herdr/shared']` (+ `server.fs.allow: ['..']` if needed) in `web/vite.config.ts`; `moduleResolution: "bundler"` follows imports fine. React is a peerDep of shared; pin web + mobile to the Expo SDK's exact React version (SDK 54 → React 19.1, matches web's ^19.1.0 — verify at bootstrap).

## Markdown: split parse from render

Keep the custom engine (RN markdown libs can't do the load-bearing bits: bare-filesystem-path linkification `pathish`, trailing-punct `shed()`, escape-first, `#`→bold headers, GFM tables, exact web parity). Refactor `md.ts` (~180 lines):
- `md/parse.ts`: `parseMd(src): Block[]` — Block = code|table|para, Inline = text|strong|code|link|file. Parser runs on raw text (escaping becomes renderer concern).
- `md/render-html.ts`: reproduces today's HTML exactly; web's `md()` = `mdToHtml(parseMd(src))`, components keep `dangerouslySetInnerHTML` + `a[data-file]` delegation untouched.
- **Parity gate**: vitest snapshot corpus (real transcripts, tables, fences, path-heavy output) asserts old `md()` === new pipeline before web swaps over.
- `mobile/src/components/MdView.tsx`: walks the AST → nested `Text`, file nodes get `onPress` prop, links via `Linking.openURL`, code/tables in horizontal ScrollViews.

## Expo app design

- **SDK 54** (RN 0.81, React 19.1) managed workflow — verify latest at bootstrap. New Architecture on (default). P1 uses zero custom native modules → **Expo Go** is the dev runtime; EAS/Mac for release + Phase-3 push (Expo Go dropped remote push in SDK 53).
- **expo-router**: `app/index.tsx` (roster) · `app/agent/[paneId]/index.tsx` · `app/agent/[paneId]/file.tsx` (P2) · `app/settings.tsx`. Deep links free for P3 push taps.
- **SSE**: `react-native-sse` (pure JS/XHR, Expo Go safe) wrapped in the adapter with lib-retry disabled — our hooks own reconnection. Fallback if flaky: `expo/fetch` streaming + hand-rolled SSE line parser (unit-testable), drop-in behind the 30-line seam.
- **Storage**: server URL + token in `expo-secure-store`; drafts/prefs via AsyncStorage-backed kv keeping the `herdr.*` key registry.
- **Composer / keyboard (the #1 reason this app exists — web keyboard feel is the pain point)**: `react-native-keyboard-controller` (native-thread keyboard-synced animation; NOT the janky built-in KeyboardAvoidingView), `autoCorrect={false}` etc. to kill the QuickType/accessory bar, `keyboardDismissMode="interactive"` for drag-to-dismiss, multiline TextInput growing via onContentSizeChange capped ~30% window height, Keyboard.dismiss() on slash-command send, restored-draft select-all via `selection` state. Note: keyboard-controller is a native module → not in stock Expo Go; do a one-time **development build** (EAS cloud or Mac) early, then the Linux JS hot-reload loop continues unchanged. Fold this into task 6/7 rather than discovering it at task 12.
- **Transcript**: inverted FlatList over reversed `buildNodes` with `maintainVisibleContentPosition={{minIndexForVisible: 0, autoscrollToTopThreshold: 120}}` — gives the web's follow/disengage behavior for free. FlashList only if it chugs.
- **Styling**: plain StyleSheet + `theme.ts` with the style.css palette verbatim (bg #0e0e13, accent #7aa2f7, blocked #f7768e, working #e0af68, done #9ece6a, idle #565f89). Dark-only.
- **Server URL**: default to the tailscale-serve HTTPS URL (avoids ATS exceptions in release builds).

## Phase 1 tasks (build order)

0. **Fresh clone** — this work happens in a separate checkout so the main repo stays free for unrelated herdr-web fixes: `git clone /home/armen/src/herdr-web /home/armen/src/herdr-mobile`, work on a `mobile` branch there (origin = the local main repo; merge back when it's stable). Copy this plan into the clone as `PLAN-MOBILE.md` so it lives with the code.
1. **Workspace scaffold** — root package.json, empty shared/. Verify: `node server.js` + `npm run build` in web unchanged.
2. **Extract pure modules** — types/transcript/chrome/roster-groups/md(unsplit)/spawn to shared; re-export shims in web/src. Verify: `npm run check` + identical web behavior.
3. **api seam** — configureApi/apiUrl; web on defaults. Verify web auth + endpoints via vite proxy.
4. **Platform adapter + hook move** (critical) — port the 3 hooks, extract session-reducer.ts, register platform.web.ts. Verify on web: daemon kill → banner → reconnect; background 30s → revive; live interrupt flow.
5. **Shared tests** — vitest: reducer reconciliation, buildNodes, stripChrome rounded-vs-sharp, chromeVisible, pathish/shed.
6. **Expo bootstrap + tailnet dev loop** — create-expo-app in workspace; metro monorepo config (auto since SDK 52, else watchFolders). `REACT_NATIVE_PACKAGER_HOSTNAME=<stormer tailnet name> npx expo start --lan` → Expo Go on iPhone; `--tunnel` fallback. Verify hot reload on phone.
7. **RN platform adapter + settings** — react-native-sse wrapper, hydrated kv, AppState+NetInfo, Alert; settings screen with probe-on-save (ports TokenGate.tsx), SecureStore.
8. **Roster screen** — useRoster + SectionList via shared buildGroups('workspace'); status dots/words, connection banner, blocked badge.
9. **Agent screen skeleton** — useAgentSession wired, raw event list. Verify: background/airplane-mode toggle → clean rebuild with fresh offset, NO duplicate events (the key invariant).
10. **Markdown split** — parse/serialize refactor + parity snapshots; swap web; build MdView.
11. **Transcript UI** — inverted FlatList + MineBubble/ActivityGroup/StepRow/CommandPill/TurnMeta/WorkingPill + follow behavior.
12. **Composer** — input/grow/drafts(kv)/send/stop+cooldown/key strip/restored-draft select-all.
13. **Interrupt end-to-end** on device — stop mid-turn → salvage + ⏹ divider → draft restored → C-c clear → resend queues behind clear.
14. **BlockedCard** — ask/menu/permission cards, {keys, expect}, 409 → forced key strip, 600ms refresh after answer.
15. **LiveTail** — 1.2s poll, shared stripChrome, kv open state. **P1 done: daily-drivable.**

**Web strategy (decided)**: the DOM web app stays the desktop daily driver, untouched. Enable Expo's web output (`react-native-web`, a config flag since mobile views are RN primitives anyway) as a zero-cost audition — a phone-shaped browser build of the same trees, so Armen can judge RNW firsthand. No commitment to ever migrating desktop web; the shared logic layer keeps that door open either way.

## Phase 2/3 sketch

- P2: FileViewer route, NewChatSheet (kinds/projects/worktrees, POST /api/chats with long timeout — spawn can take 60s), image attach (expo-image-picker → POST /api/upload → `[pasted image: path]`), ScreenMirror (shared chromeVisible + poke), roster group-by tabs + quick-spawn + Overview cards.
- P3: expo-notifications + APNs sender in `lib/notify.js` (hand-rolled on node:crypto per the zero-dep rule) + subscribe endpoint; notification tap deep-links to `/agent/[paneId]`; needs EAS/dev build (first Mac touchpoint).

## Testing

- Shared package under vitest/node on Linux: session reducer (confirm/reconcile/stopped/command-swallow/insert-around-interrupt), buildNodes, chrome strippers, md parse + **HTML-parity snapshots**, apiUrl token logic, roster-groups.
- Hooks under @testing-library/react with a **fake Platform** (scripted SSE): reconnect/watchdog/wake invariants — first automated protection those bug fixes have ever had, covering both clients at once.
- On-device manual: tasks 9 and 13 against the live daemon. Web keeps `npm run check` + the new shared suite.

## Risks (ranked)

1. react-native-sse quality (XHR buffering/silent death) → adapter seam makes the fetch-stream fallback drop-in; watchdogs already recover from silent stalls.
2. iOS background socket death → exactly what the hooks were hardened for; onWake + wall-clock staleness self-heals; verified explicitly at task 9.
3. React version skew in workspace (duplicate react) → pin exact version from Expo SDK; `npm ls react` at bootstrap.
4. Markdown refactor regressing web → parity snapshot corpus gates the swap.
5. Metro + workspaces raw-TS resolution → auto since SDK 52; explicit watchFolders fallback.
6. Inverted-FlatList/keyboard quirks → standard chat pattern; non-inverted + manual scrollToEnd fallback (direct port of Transcript.tsx:170-178).

# Capra refresh — parity with herdr-web, then the cyber skin

Drafted 2026-10-19. Companion to `PLAN-MOBILE.md` (the original build plan, phases 1–2 shipped Aug 2026).

## Where things stand

**2026-10-20 (overnight session):** phases 0–4 are done and committed; the
cyber skin is at tier C minus the garnish. What landed, in order:
`d8a0acb` (own agent header, growing composer, mode chip + picker, /rewind
and /resume cards, jump pill, multi-select live toggle), `b7bb95c` (launcher
model in `shared/src/launcher.ts` with vitest; web dialog and Capra sheet
both on it; every ＋ opens the launcher; pull-to-refresh; row ages),
`189bf82` (tap-to-copy, inline video/audio, flicker/packet/sweep/boot-log
motion, Skia rain + bloom + vignette, opaque `Screen` roots). Native deps
added and ABI-checked against ExpoModulesCore 57.0.8: expo-haptics 57.0.1,
expo-video 57.0.2, expo-audio 57.0.3, react-native-skia 2.14.0 — the Mac
dev client was rebuilt (`pod install` + `xcodebuild`, recipe in the
ios-simulator-loop memory). Still open: push (phase 5, needs an APNs key),
chamfers (Skia clip, not started), alternate app icon / splash on cyber,
ticker and scramble text, and an on-device perf read of the rain behind a
scrolling transcript. Below is the original plan as drafted on 10-19.

**2026-10-20 (daytime, from the first real use of build 19):** six more
builds. `0897a1a` composer growth (Yoga-sized, no pinned height — Fabric
stalls it). `0ac7b16` transcript window: `GET /transcript?tail=N&end=I`
turn-aligned, tool results clipped server-side to the 20k the UIs show (a
14 MB pane became 234 KB; web gets the lighter payload too), Capra opens
with 120 events and pages back on scroll (`34887c1`). `66df1f8` the
Dynamic Type clip: the test phone is at text size Extra Large; a lineHeight
Text under RN scaling clipped its last line — `t.px()` + allowFontScaling
off (rule in theme.ts). `34887c1`/`32cc1da` motion diet: perpetual
Reanimated loops cost ~20% of a core idle (packets, not the rain); packets
run only while working and rest on a JS timer, rain steps 8×/s. `00b1652`
text size knobs: the four web areas in shared/src/fonts.ts, per device,
settings steppers, live. Phase 4 is now complete. Then `f579357` autocorrect
switch + no dead band above the keyboard, `fcde912` one-frame composer +
shrink after send, and `252bf8e` **over-the-air updates**: expo-updates on
the production channel, `ios-update.yml` publishes on every push, the
native TestFlight build (`ios-testflight.yml`) runs only on `[build]` in
the commit subject (free EAS plan, 30 builds/month). Then the first OTA-only
fixes (scroll on send, clear-button baseline, About row) and **herdr
management verbs**: `POST /api/agent/:pane/rename|close` and
`/api/workspace/:id/rename|close` (server, e2e-tested), Capra long-press on
a row / workspace header and tap on the agent header name → rename, close.
Entering a pane no longer blanks: the shared hook remembers the last 8
panes (items + stream offset, resumes the stream instead of fetching) and
the server keeps an incremental parse cache per session file (transcript
GET 0.22 s → 3 ms); the stream now emits `offset` frames.
Evening: the **visual flare pass** to web's cyber motion — status
diamonds tick round while working (a quarter-turn every 1.5 s; continuous
spin was +7 points of a core on the home list) and flicker while blocked,
a packet under working rows and an alarm sweep over blocked ones (list and
cards), the sign's periodic glitch, the armed send button breathes, scramble
text on titles (rows, groups, cards, agent header, nav title, the sheet's
place), and the boot log carries web's copy with the server host. All new
effects honour Reduce Motion. Web's ticker CSS has no caller, so no ticker.
Open: push (phase 5), the same verbs on web (no rename/close UI there yet),
a **new-chat redesign shared by web and Capra** plus the management verbs
in it, a disk cache of the last panes for cold launches, a motion setting
(full/calm/off), alt icon/splash, local `eas build --local` on the Mac, the
notify.test.mjs ordering flake.


- `mobile/` on `main` is the real app. The `~/src/herdr-web2` clone on branch `react-native` is a stale July snapshot; ignore it.
- Last substantive mobile commits: 2026-08-06 (black-box fixes, build 8 on TestFlight) and 2026-10-06 (blocked cards, cursor menus, live mirror). Mobile did **not** get the 2026-10-16 batch.
- Expo SDK 57 / RN 0.86 / React 19.2.3 since August, same React as web. `tsc --noEmit` and `vitest` pass today. No new dev-client build is needed until a native module is added.
- The reason Capra got shelved ("never followed grok chats") was server-side and has since been fixed for every client: newest `active_sessions` row per pid (08-12), filesystem session scan (08-06), exact pid-registry binding (10-16). Step 0 is to confirm that on the phone.
- Web itself has two regressions mobile is ahead on: `LiveTail.tsx` and `AgentView.tsx` keep private copies of the chrome regexes and missed the codex `›` / pi status-row patterns that went into `shared/src/chrome.ts`. Fix web to import from shared (10 minutes, do it in phase 0).

## Gap inventory (web has it, mobile doesn't)

**List / home**
- `recent` group mode resets to `workspace` every launch (`mobile/app/index.tsx:35-38` only accepts three modes); `flat` and `defaultClosed` are ignored, so recent mode shows a blank sticky header and the stale fold starts open.
- No "3m / 2h" ages (`lastActiveAt` is never read), no row declutter (agent name and folder always printed), no "N empty spaces" fold, group menu has no descriptions.
- No freshness dot and no pull-to-refresh; `syncedAt` / `refresh` / `refreshing` from `useRoster` unused.
- ＋ still instant-spawns with the last kind. Web dropped that on 10-16 (stray taps). Mirror web: ＋ opens the launcher pre-aimed at the current chat.
- Cards view: web lists each project's workspaces; mobile doesn't. Mobile still shows the "start somewhere" dormant projects that web removed.
- `useRoster()` is called in four screens → four SSE streams, and since 10-16 four `POST /api/roster/refresh` on every wake. Lift to one provider.
- Agent header bypasses `chipName`, so it shows `claude-w33p7` style auto-labels.

**Launcher** (`NewChatSheet.tsx` is the old flat form)
- No place-first flow, no filter box, no resume list (claude/grok/codex/pi), no live-session jump.
- One claude-only yolo switch instead of the five permission modes; no grok `--always-approve`, no codex mapping; no per-kind last-mode memory.
- Options not folded behind a summary.

**Agent screen**
- No `/rewind` panel, no `/resume` card, no permission-mode chip/picker (`useAgentMode`).
- pi/codex `/new` works (server follows the stream) but mobile leaves a never-confirmed pending bubble and opens the mirror on pi's "New session started".
- Multi-select blocked card has `done` but no live-screen toggle.
- No scroll-to-bottom button on the inverted FlatList.

**Transcript / composer / files**
- No tap-to-copy on code / bold / pre. (Text selection stays off on purpose: iOS layer-cap bug, see `ios-text-layer-limit`.)
- Compaction `note` renders as a generic "ℹ️ note" row instead of the "⟲ context compacted" divider.
- Composer is a fixed 88px box; web grows with content.
- Video/audio files render **blank** (no branch for the new `kind`s); no player dependency.
- **Security bug:** share sheet hands out `apiUrl(...)`, which carries `?token=`. The token leaks into whatever gets shared.

**Settings / prefs / push**
- Mobile never calls `/api/prefs`: no theme, no palettes, no color overrides, no text-size knobs. `mobile/src/theme.ts` is a hard-coded stock palette.
- No push at all. Server only speaks Web Push (`lib/notify.js` + `lib/webpush.js`).

**Mobile-only (keep, consider back-porting to web)**
- Camera + any-file attach as `[pasted file:]` (server already accepts it).
- `capra://settings?server=&token=` deep link + QR enrolment. iOS share sheet.

## Plan

Effort is in "sessions": one focused Claude loop with a human testing on the phone between rounds, roughly a half-day. Dev loop stays Linux: `npm run dev:mobile` over the tailnet into the existing SDK-57 dev client.

### Phase 0 — the black box and the build pipeline (1–2 sessions, blocks everything)
Opening Capra on 2026-10-19, this session rendered as a big empty box. **Found and fixed the same day** (commit after 75cd525):
- **Root cause:** a `ScrollView` nested inside a FlatList cell under Fabric (RN 0.86). MdView rendered code blocks and tables in `ScrollView horizontal`; once the list re-lays out (every SSE batch), the Yoga height of every ancestor View of that ScrollView grows without bound (the 648-char reply measured 106k → 144k → 380k pt while its three blocks stayed at 372 pt), so the bubble draws as a giant blank box and neighbours overlap it. Nothing to do with Text size: the layer-cap and selectable-renderer theories were both wrong, and the inline-span suspects (code-span background, `monospace`, lineHeight, span count) all drew fine.
- **Fix:** no ScrollView in MdView at all. Code lines wrap (Menlo on iOS via `Platform.select`, since `monospace` is not an iOS family), tables are a flex grid. Ruled out as fixes in the replay: `inverted` off, `maintainVisibleContentPosition` off, `gap`→margin, `nestedScrollEnabled` off, fixed-height ScrollView, vertical ScrollView. A plain View with Yoga `overflow: scroll` is fine, so it is the native ScrollView component, not Yoga. Horizontal scrolling for wide tables is gone until there is an upstream fix; re-test with the replay before bringing it back. Nothing else in the transcript nests a ScrollView; LiveTail/ScreenMirror/FileViewer/NewChatSheet use one but not inside list cells.
- **Diagnosis tooling, kept:** `mobile/app/lab.tsx` (static MdView variants, `capra://lab?inv=1&v=…`) and `mobile/app/replay.tsx` (`capra://replay?pane=w3K:p1&turns=2&end=290`): feeds a real pane's transcript through the real `<Transcript>` with turn-end flips and logs every cell's measured height to Metro as `[cell]` lines. The static lab never reproduced it; the replay reproduces it in 20 seconds. The iOS Simulator on the Mac reproduces it; the Android emulator does not.
- **Build pipeline:** the "Apple 403" / provisioning lines are noise (an App Store Connect agreement needs accepting, it only affects the TestFlight-group step). The real failure was Xcode 27.1 on the `latest` EAS image choking on expo-modules-jsi's xcframework script phase ("exit code 0 but produced no further output"). `eas.json` now pins `macos-tahoe-26.5-xcode-26.6`, the image build 11 shipped on.
- Small: the `ℹ️ note` aux label draws as two `?` glyphs in the Simulator (emoji + variation selector); check on a device, swap for a plain word if real.
0. Confirm grok/codex/pi chats follow correctly on device (the original shelving reason).
2. Share-sheet token leak: download to cache via `expo-file-system` and share the local file; never hand out a tokened URL.
3. One `RosterProvider` in `_layout.tsx`; screens read from context.
4. Accept `recent`, honor `flat` / `defaultClosed`; `chipName` in the agent header; compaction divider; video/audio at least get a share/download fallback.
5. Web: point `LiveTail.tsx` / `AgentView.tsx` at `shared/src/chrome.ts`.
6. Drop the pending bubble + mirror-open on pi/codex `/new`.

### Phase 1 — list and launcher (2 sessions)
- Extract the launcher model out of `NewChatDialog.tsx` into `shared/src/launcher.ts`: places (`dominant` is already shared), the permission-mode table per kind, per-kind mode memory via `platform.kv` (its only DOM touch is `localStorage`, lines 85/93). Vitest it. Web swaps to the shared module first (parity gate), then mobile.
- Mobile list: ages, declutter rules, empty-space fold, group menu with descriptions, freshness dot, `RefreshControl` on both list and cards, ＋ → launcher pre-aimed, cards list workspaces, drop "start somewhere".
- Mobile launcher rebuilt on the shared model: place row + change sheet, filter, resume list, five modes, folded options with summary.

### Phase 2 — agent screen (1.5–2 sessions)
- Move `useAgentMode` to shared (`alert` → `platform.notifyError`, otherwise fetch + timers). Mode chip + picker, kept current by the live screen.
- `/rewind` + RewindCard, `/resume` + ResumeCard (ports; the only DOM touch is one `alert`). Slash-override routing from `AgentView.tsx:150-277` goes into a shared helper.
- Multi-select live-screen toggle; scroll-to-bottom pill driven by the FlatList `onScroll` + new-content flag.

### Phase 3 — transcript, composer, files (1.5 sessions)
- `MdView`: Pressable on inline code, fenced blocks and bold → clipboard + haptic + toast. Still no selection.
- Composer auto-grow via `onContentSizeChange`, capped at ~30% of window height (this was in the original plan and never landed).
- `expo-video` + `expo-audio` (both stable in SDK 57, Expo Go safe) in FileViewer; byte ranges work out of the box with AVPlayer; share/download for media.

### Phase 4 — prefs sync and theme plumbing (1.5–2 sessions; this is cyber tier A, see below)
- `ThemeProvider` + `useTheme()`; convert the 16 `StyleSheet.create` blocks (258 `colors.` refs) to `makeStyles(theme)` memoised per theme. Same pass adds a `fs(area)` scale helper to every `fontSize` so the four text-size knobs work.
- Move `palettes.ts` and the color math (`mix`, `luma`, surface-ramp derivation) from `web/src/prefs.ts` to shared; the only DOM-bound bit is `defaultColor` reading computed CSS, which becomes a static stock table.
- `/api/prefs` GET on boot + wake, PUT debounced 400ms, AsyncStorage cache so boot doesn't flash. Text sizes stay per device (AsyncStorage).
- Settings screen gains an Appearance section: theme switch, palette grid, color knobs, four sliders.

### Phase 5 — push (2–3 sessions, needs an APNs key from the Apple developer account)
- Client: `expo-notifications`, categories with up to two answer actions, deep link to `agent/[paneId]` on tap, token registered via a new `/api/push/apns` route.
- Server: a second transport in `lib/notify.js`. Recommend **direct APNs over HTTP/2 with token auth** (`node:http2` + ES256 JWT from `node:crypto`, zero-dep like `webpush.js`), not Expo's push relay: the payload carries the agent's actual question and that traffic stays local. `apns-collapse-id` gives the coalesce/retract semantics the web path already has.
- Dev client must be rebuilt once (push entitlement). EAS cloud build from Linux is fine.

### Phase 6 — cyber skin, tiers B and C (optional, 3–5 sessions; costed below)

### Testing lane
- Shared extractions get vitest coverage (launcher model, mode tables, palette math).
- The `react-native-web` audition (`expo start --web`) plus playwright's local chromium against the existing `e2e/mock` server gives a headless e2e lane for mobile screens. Add a `capra` project to `e2e/playwright.config.mjs` with the 390×844 viewport.

**Parity total: ~8–9 sessions without push, ~11 with.**

## Cyber theme on mobile — cost

Mobile currently has no theming at all: one static `colors` object and `StyleSheet.create` everywhere. Three tiers, each usable on its own.

**Tier A — tokens, palettes, prefs sync (≈ 2 sessions, and it is phase 4 anyway).**
Theme provider, the 9 presets, custom overrides, synced with web through `/api/prefs`, fonts via `@expo-google-fonts/orbitron`, `chakra-petch`, `share-tech-mono` bundled (no runtime fetch). Square radii, diamond status dots (rotate 45°), warm eggshell text. This alone makes Capra switch skins in lockstep with the browser and gets maybe 60% of the look for 30% of the cost. Composer stays in Chakra Petch 400 (proportional), matching the web version.

**Tier B — shape and light, static (≈ 1.5 sessions).**
- Chamfered cards/buttons (`clip-path: polygon`): no clip-path in RN. A `Chamfer` wrapper drawing an `react-native-svg` polygon background + stroke. Used on sessions, overview cards, assistant bubbles, send button.
- Glow: RN 0.86 (new arch) has the `boxShadow` and `filter` style props with multiple shadows, so the two-layer `--glow` ports directly. `textShadow*` is single-layer; one layer reads fine.
- Grid on surfaces and the scanline + vignette overlay: one full-screen `pointerEvents="none"` SVG with a `Pattern` fill plus a `RadialGradient`; `mixBlendMode: 'multiply'` exists in RN 0.86. Cheap to render because it is static.
- Gradient bar underline, slanted chips, HUD brackets: svg or plain borders.

**Tier C — motion (≈ 2–2.5 sessions).**
Reanimated 4 is already installed. Glitch on the title, flicker on blocked, composer sweep, neon-on for new rows, edge beacon, the ticker marquee, boot log overlay (Text + timers), decrypt-scramble as a `<Scramble>` text component that animates on mount (no MutationObserver needed, components opt in), CRT-off jack-out. Each is small; the sum is the cost.
Digital rain is the one real outlier: canvas work at 14 fps across ~30 columns. Do it in `@shopify/react-native-skia` (native module → one dev-client rebuild, which push needs anyway) or skip it. Budget 0.5–1 session including an on-device perf check with the rain behind a scrolling FlatList.

**Full skin ≈ 6–7 sessions; tier A alone ≈ 2.** Recommendation: fold tier A into the parity work since the prefs sync is a parity item, look at it on the phone, then decide whether B/C are worth it on a 6-inch screen. Scanlines and glow carry most of the mood; rain and glitch are the expensive garnish.

## Order

0 → 1 → 2 → 3 → 4 (tier A) → 5 (push) → 6 (B/C if wanted). Each phase ends daily-drivable; nothing in 1–4 needs a new native build.

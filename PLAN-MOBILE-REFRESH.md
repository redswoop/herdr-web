# Capra refresh — parity with herdr-web, then the cyber skin

Drafted 2026-10-19. Companion to `PLAN-MOBILE.md` (the original build plan, phases 1–2 shipped Aug 2026).

## Where things stand

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

Effort is in "sessions": one focused Claude loop with Armen testing on the phone between rounds, roughly a half-day. Dev loop stays Linux: `npm run dev:mobile` over the tailnet into the existing SDK-57 dev client.

### Phase 0 — the black box and the build pipeline (1–2 sessions, blocks everything)
Armen opened Capra on 2026-10-19 and this session rendered as a big empty box. Facts:
- The phone can only have **build 11 (f53423b, 2026-08-07)**: the 2026-10-16 push triggered build 12, which failed in EAS (Xcode step "exit code 0, no further output", preceded by "Failed to fetch Apple provisioning profiles" and "Apple 403 detected" on the TestFlight group step). The 10-06 blocked-card work has never reached a phone. Look at the expo.dev log for build `ecb6933c` (needs `eas login`) and check the App Store Connect API key / agreements before anything else.
- Two theories are now dead. Layer cap: f53423b's own measurement put the boxed message well under 8192px. Selectable-Text renderer: build 11 turned selectable off and the box is still there.
- This session's transcript run through the segmenter today: largest Text ≈ 1770 chars / ~1200pt, widest table row ≈ 650pt. Nothing near a size limit.
- Live suspects, by what draws vs what doesn't (bubble background + flat sibling Texts draw, the markdown body doesn't): nested `<Text>` spans with `backgroundColor` (inline-code style) under Fabric, nested-span `fontFamily: 'monospace'` (not a real iOS family), `onPress` handlers on nested spans.
- **Render lab built 2026-10-19** (uncommitted): `mobile/app/lab.tsx`, reachable from Settings → "render lab" or `capra://lab`. The boxed reply is the fixture (`mobile/test/fixtures/black-box-reply.md` → `mobile/src/lab-fixture.ts`, a test pins them equal). Six variants via `MdLabContext` in MdView: A as-is · B no code-span background · C system font on code spans · D no lineHeight · E ≤10 spans per Text · F flattened to one string. Toggle to host them in an inverted FlatList like the transcript; chips isolate one variant. Verified in the react-native-web audition (all six draw there, as expected: the bug is iOS-only). Run it on the phone with the dev client: `REACT_NATIVE_PACKAGER_HOSTNAME=stormer.tail93d23c.ts.net npx expo start --lan` in mobile/. The variant that draws names the cause; then fix MdView for real and delete the lab.
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
- Server: a second transport in `lib/notify.js`. Recommend **direct APNs over HTTP/2 with token auth** (`node:http2` + ES256 JWT from `node:crypto`, zero-dep like `webpush.js`), not Expo's push relay: the payload carries the agent's actual question and Armen keeps that traffic local. `apns-collapse-id` gives the coalesce/retract semantics the web path already has.
- Dev client must be rebuilt once (push entitlement). EAS cloud build from Linux is fine.

### Phase 6 — cyber skin, tiers B and C (optional, 3–5 sessions; costed below)

### Testing lane
- Shared extractions get vitest coverage (launcher model, mode tables, palette math).
- The `react-native-web` audition (`expo start --web`) plus playwright's local chromium against the existing `e2e/mock` server gives a headless e2e lane for mobile screens. Add a `capra` project to `e2e/playwright.config.mjs` with the 390×844 viewport.

**Parity total: ~8–9 sessions without push, ~11 with.**

## Cyber theme on mobile — cost

Mobile currently has no theming at all: one static `colors` object and `StyleSheet.create` everywhere. Three tiers, each usable on its own.

**Tier A — tokens, palettes, prefs sync (≈ 2 sessions, and it is phase 4 anyway).**
Theme provider, the 9 presets, custom overrides, synced with web through `/api/prefs`, fonts via `@expo-google-fonts/orbitron`, `chakra-petch`, `share-tech-mono` bundled (no runtime fetch). Square radii, diamond status dots (rotate 45°), warm eggshell text. This alone makes Capra switch skins in lockstep with the browser and gets maybe 60% of the look for 30% of the cost. Composer stays in Chakra Petch 400 (proportional), per Armen's verdict on the web version.

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

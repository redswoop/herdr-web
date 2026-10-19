Plan's written to `PLAN-MOBILE-REFRESH.md` at the repo root. Here's the shape of it.

**Good news first.** Capra isn't as rotten as "haven't touched it in a long time" suggests. It's on Expo SDK 57 / RN 0.86 / React 19.2.3, same React as web, typechecks clean, tests pass, and it got the 2026-10-06 blocked-card work. The reason you shelved it (never followed grok chats) was server-side and has been fixed three times over since August, so step 0 is literally "open it and see if grok follows now." The thing it missed is the 2026-10-16 batch. Also: the `~/src/herdr-web2` clone is a stale July snapshot, so the real app is `mobile/` on main.

**The gap, roughly in order of pain:**

1. **No push at all.** Server only speaks Web Push.
2. **No resume, no rewind, no mode chip.** `/resume` and `/rewind` go raw to the TUI.
3. **List is stale.** Recent mode silently resets to workspace every launch, stale group starts unfolded, no ages, no freshness dot, no pull-to-refresh. Also four screens each open their own roster SSE stream and now each fire a refresh POST on every wake.
4. **Launcher is the old flat form.** No place-first flow, no filter, one claude-only yolo switch instead of five modes, ＋ still instant-spawns.
5. **Transcript/files.** No scroll-to-bottom, no tap-to-copy, video/audio files render blank.
6. **Security bug, not parity:** the share sheet hands out the `apiUrl` which carries `?token=`. Your access token leaks into whatever you share. Phase 0 item.

Two things mobile is actually ahead on: camera/any-file attach, and the chrome regexes. Web's LiveTail and AgentView kept private copies and missed the codex `›` / pi status-row patterns that went into shared. Ten-minute web fix, I put it in phase 0.

**Phases** (a "session" = one focused loop with you testing on the phone between rounds):

| Phase | What | Sessions |
|---|---|---|
| 0 | token leak, one RosterProvider, recent-mode fixes, web chrome regex fix | 1 |
| 1 | launcher model → shared, list declutter, place-first launcher, five modes | 2 |
| 2 | useAgentMode → shared, rewind/resume cards, mode chip, scroll-to-bottom | 1.5–2 |
| 3 | tap-to-copy, composer auto-grow, expo-video/audio | 1.5 |
| 4 | ThemeProvider + /api/prefs sync + text-size knobs (= cyber tier A) | 1.5–2 |
| 5 | push: expo-notifications + direct APNs over http2 in lib/notify.js | 2–3 |

Parity ≈ 8–9 sessions without push, ≈ 11 with. Nothing in phases 0–4 needs a new native build. Push does, and I'd go direct APNs with a zero-dep ES256 JWT rather than Expo's relay, since the payload carries the agent's actual question.

**Cyber theme cost.** Mobile has zero theming today: one static `colors` object across 16 `StyleSheet.create` blocks. Three tiers:

- **Tier A, ≈ 2 sessions:** theme provider, the 9 palettes, custom overrides, synced with web via prefs, bundled Orbitron/Chakra Petch/Share Tech Mono, square radii, diamond dots. This is phase 4 anyway. Gets you about 60% of the look for 30% of the cost, and Capra flips skins in lockstep with the browser.
- **Tier B, ≈ 1.5 sessions:** chamfers (no clip-path in RN, so an svg polygon wrapper), glow (RN 0.86 has multi-shadow `boxShadow` and `filter` props, so that ports straight), grid + scanlines + vignette as one static SVG overlay with `mixBlendMode`.
- **Tier C, ≈ 2–2.5 sessions:** all the motion via Reanimated 4, which is already installed. Boot log, scramble, ticker, glitch, flicker, sweeps are each small. Digital rain is the outlier: needs Skia, which is a native module and a dev-client rebuild. Budget 0.5–1 of that for rain alone, or skip it.

Full skin ≈ 6–7 sessions, tier A alone ≈ 2. My recommendation: fold A into the parity work, look at it on the phone, then decide if B/C earn their keep on a six-inch screen. Scanlines and glow carry most of the mood; rain and glitch are the expensive garnish.

Memory updated: Capra's back on, and the old note claiming the `capra://` deep link doesn't work was stale since August.
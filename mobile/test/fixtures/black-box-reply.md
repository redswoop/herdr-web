Plan's written to `PLAN-SYNC.md` at the repo root. Here's the shape of it.

**Good news first.** The sync layer isn't as rotten as "nobody has touched it in a long time" suggests. It's on the current SDK, same runtime as the desktop build, typechecks clean, tests pass, and it already got the conflict-marker work from last month. The reason it was shelved (never caught up after a long offline stretch) was a server-side cursor bug and has been fixed since, so step 0 is literally "open it and see if it catches up now." The thing it missed is the batch from two weeks ago. Also: the `~/src/sync-old` clone is a stale snapshot, so the real code is `packages/sync/` on main.

**The gap, roughly in order of pain:**

1. **No background refresh at all.** Client only syncs on foreground.
2. **No retry, no backoff, no jitter.** `/pull` and `/push` go raw to the network.
3. **List is stale.** Sort mode silently resets every launch, collapsed groups reopen, no ages, no freshness dot, no pull-to-refresh. Also four screens each open their own change stream and now each fire a refresh on every wake.
4. **Editor is the old flat form.** No section picker, no filter, one global toggle instead of five modes, ＋ still creates instantly.
5. **Attachments.** No scroll-to-bottom, no tap-to-copy, video/audio render blank.
6. **Security bug, not parity:** the share sheet hands out the `apiUrl` which carries `?token=`. Your access token leaks into whatever you share. Phase 0 item.

Two things the client is actually ahead on: camera/any-file attach, and the status-line regexes. Desktop kept private copies and missed the two newer patterns that went into shared. Ten-minute desktop fix, I put it in phase 0.

**Phases** (a "session" = one focused loop with you testing on the device between rounds):

| Phase | What | Sessions |
|---|---|---|
| 0 | token leak, one ChangeProvider, sort-mode fixes, desktop regex fix | 1 |
| 1 | editor model → shared, list declutter, section-first editor, five modes | 2 |
| 2 | useEditMode → shared, history/restore cards, mode chip, scroll-to-bottom | 1.5–2 |
| 3 | tap-to-copy, composer auto-grow, video/audio | 1.5 |
| 4 | ThemeProvider + `/api/prefs` sync + text-size knobs | 1.5–2 |
| 5 | push: notifications + direct APNs over http2 in `lib/notify.js` | 2–3 |

Parity ≈ 8–9 sessions without push, ≈ 11 with. Nothing in phases 0–4 needs a new native build. Push does, and I'd go direct APNs with a zero-dep ES256 JWT rather than a relay, since the payload carries the actual note text.

**Theme cost.** The client has zero theming today: one static `colors` object across 16 `StyleSheet.create` blocks. Three tiers:

- **Tier A, ≈ 2 sessions:** theme provider, the 9 palettes, custom overrides, synced via prefs, bundled fonts, square radii, diamond dots. This is phase 4 anyway. Gets you about 60% of the look for 30% of the cost, and the client flips skins in lockstep with desktop.
- **Tier B, ≈ 1.5 sessions:** chamfers (no clip-path, so an svg polygon wrapper), glow (multi-shadow `boxShadow` and `filter` props port straight), grid + scanlines + vignette as one static SVG overlay with `mixBlendMode`.
- **Tier C, ≈ 2–2.5 sessions:** all the motion via the animation lib, which is already installed. Boot log, scramble, ticker, glitch, flicker, sweeps are each small. Digital rain is the outlier: needs a native module and a dev-client rebuild. Budget 0.5–1 of that for rain alone, or skip it.

Full skin ≈ 6–7 sessions, tier A alone ≈ 2. My recommendation: fold A into the parity work, look at it on the device, then decide if B/C earn their keep on a six-inch screen. Scanlines and glow carry most of the mood; rain and glitch are the expensive garnish.

Notes updated: the client's back on, and the old note claiming the deep link doesn't work was stale since spring.
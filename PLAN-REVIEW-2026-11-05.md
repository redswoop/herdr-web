# Review follow-ups, 2026-11-05

Two review passes on 2026-11-05: one over the then-uncommitted tree (multi-select
submit, tab-strip ×, long-press menu, watch app), one over `f579357..HEAD` (the
40 commits since 2026-10-20, 211 files). Everything below was confirmed against
the code, not just reported. Work the phases in order: phase 1 is a security
hole on the default config, phases 2–3 are user-visible lies (the client says
"ok" while the agent is still blocked), the rest is correctness and hygiene.

Each item has: where, what's wrong, the fix, and how to prove it. Tick the box
when the proof passes. `npm test` runs the node unit tests (`test/*.test.mjs`);
e2e lives in `e2e/` and MUST use port overrides (see memory: 7684 is the
comfy-grok sidecar).

## Phase 1 — security

- [x] **Open CORS on a tokenless server** — `server.js:1711`
  The `access-control-allow-origin: *` header is set for any request carrying
  an Origin, before `checkAuth`. The comment claims every cross-origin call
  must carry `?token=`, but that only holds when `HERDR_WEB_TOKEN` is set. On
  the loopback default (and with `--insecure` on a LAN IP) any other page the
  browser has open can `fetch('http://localhost:7683/api/file?path=~/.ssh/id_ed25519')`
  and read the body: Host passes `hostAllowed`, `checkAuth` returns true with
  no TOKEN, ACAO:* unlocks the response.
  Fix: only emit the ACAO header (and answer OPTIONS) when a token is
  configured, i.e. `if (req.headers.origin && TOKEN)`. The multi-host fan-out
  that needs CORS always runs with tokens (blackstar node has one in its
  plist), so nothing legitimate loses access. Update the comment to say so.
  Proof: tokenless server, `curl -i -H 'Origin: http://evil' localhost:7683/api/roster`
  shows no ACAO header; with `HERDR_WEB_TOKEN=x` and `?token=x` it does.
  Add a unit/e2e case for both.

## Phase 2 — multi-select submit (claude ≥ 2.1.318)

Context: `submitMultiSelect` in `server.js` (~l.532) and `submitRe` in
`lib/screen.js` (~l.40). The TUI's Submit row is unnumbered, sits under the
free-text row, and is the first thing to scroll off a tall menu. Enter on an
option row TOGGLES its box; it does not submit.

> **Executed 2026-11-05.** Everything ticked below shipped and is covered by
> `npm test` (`test/server-multiselect.test.mjs` is the fake-TUI driver test)
> plus the tabstrip / transcript e2e specs. One finding corrected the plan:
> on a short pane the claude TUI does NOT scroll the Submit row off — the
> OPTIONS scroll in a window and Submit, the rule and "Chat about this" stay
> pinned under it (verified live on a 12-row pane, claude 2.1.318). The
> numbering on screen then has holes (`1, 2, 6`), ↑/↓ share the cursor column
> (the cursor row hides its own marker), and the pinned rule sits under
> whichever option is last in the window. `parseNumberedMenu` now reports
> `scrolled: true` for that shape and `submitMultiSelect` single-steps the
> cursor when it sees it. Left open: the phone check of a long session with
> the HTML engine (needs the device), and two pre-existing phone-viewport e2e
> failures (`auth.spec` / `roster.spec` heading locator) that fail on the
> clean tree too.

- [x] **Bare-Enter fallback fires on scrolled menus** — `server.js:540`
  `if (!menu.submit) send(['Enter'])` treats "no Submit row parsed" as "old
  TUI". It is also absent when the row scrolled off (`↑`/`↓` marker rows,
  which `optRe` tolerates). Enter then flips the cursor row's box and the route
  returns 200.
  Fix: fall back only with evidence of an old TUI: no `[ ]`/`[✔]` box in any
  option label. When boxes exist and no Submit row is visible, walk the cursor
  Down past the last visible option until the row scrolls into view (bounded,
  re-read each step), then proceed. Return null (409) if it never appears.
  Also: the fallback should only apply to multi-select menus at all; a plain
  menu reaching this path is a client bug and should 400.

- [x] **`submitRe` ignores the scroll-marker prefix** — `lib/screen.js:40`
  `optRe` accepts a leading `↓ `/`↑ ` marker; `submitRe` does not, so a Submit
  row drawn on the marker line is never parsed. Accept the same prefix.

- [x] **`submitRe` steals prose lines** — `lib/screen.js:40`
  The match runs before the description-swallow and anchors on any standalone
  `Submit` line after the first option, so a permission prompt whose detail
  block contains a line `Submit` gains a bogus `submit:{after:n}` and loses
  that word from the description. `!submit?.selected` also weakens the
  "real menus have ❯" guard for numbered prose lists.
  Fix: only look for a Submit row when at least one option label carries a
  `[ ]`/`[✔]` box (the multi-select shape), and require it to sit directly
  after the free-text `input` row. Keep the ❯ guard strict.
  Proof: extend `test/screen.test.mjs` with (a) a scrolled multi-select whose
  Submit row is behind `↓`, (b) a single-select whose description contains
  "Submit", (c) a Submit row on the marker line.

- [x] **Review-step loop reports success it never saw** — `server.js:563`
  After Enter on Submit, the loop polls 10×300 ms. If Enter was dropped
  (keystroke race, parked-worker relay) the multi-select is still drawn:
  `confirm` is non-null, `options[0].label` starts with `[`, neither branch
  fires, and the function falls off the end with `return true`. Client clears
  busy; agent still blocked with a changed selection.
  Fix: after the loop, re-read once; if the parsed menu still has `.submit`
  return null (409 "screen changed" with the screen attached). Only return
  true when the menu is gone or the confirm was answered.

- [x] **`answerByNav` assumes cursor on option 1 when Submit is selected** —
  `server.js:505`
  `options.find(selected) ?? options[0]` ignores `submit.selected`, so after a
  failed "done" left ❯ on Submit, every nav answer sends the wrong Down/Up
  count and 409s until someone fixes the cursor in the TUI.
  Fix: build the same cursor `order` array `submitMultiSelect` builds (hoist
  it, see phase 5) and map `submit.selected` to its index.

- [x] **`submit` body field is untyped** — `server.js:1996`
  `if (submit)` accepts `'no'`, `1`, `{}`; siblings get 400 validation.
  Require `submit === true`, 400 otherwise.

Proof for the phase: a unit test for `submitMultiSelect` with a fake
`readScreen`/`agentRpc` (screens: Submit visible, Submit scrolled, Enter
dropped, confirm shown). Then one live run against a real claude multi-select
AskUserQuestion in a short pane. Do NOT test on a session you care about:
Enter toggles boxes.

## Phase 3 — transcript integrity

- [x] **Pane memory replays an offset into the wrong session file** —
  `shared/src/hooks/useAgentSession.ts:267`
  The remembered byte offset is reused on reopen without recording which
  session file it belonged to. Server-side reset detection is relative to the
  session at stream-open, so if the pane /clear'd, /resume'd or got parked
  while away and the new jsonl grew past the offset, the client appends the
  new file's tail (from mid-line) onto the old transcript and never reloads.
  Intermittent: a shorter new file triggers `reset` and recovers.
  Fix: store `{ offset, sessionId }` (or file path/inode as the server
  reports it) in pane memory; on reopen, if the stream's opening `session`
  record differs, discard memory and start from 0. Wire up the exported
  `clearPaneMemory` (currently never called) to the close/clear flows.
  Proof: open pane A, note offset, /clear A from the TUI, chat past the old
  size, return to A: transcript is only the new conversation. Add an e2e
  case using the transcript harness pane.

- [x] **`readEventsCached` misses rewind-then-regrow** — `lib/adapters.js:1377`
  Reset keys only on "file shrank". Rewind to a smaller checkpoint, then write
  past the cached offset before the next fetch: `size >= offset`, no reset,
  the tail is appended mid-line to stale events. `/transcript` now always
  goes through the cache, so reload does not heal it.
  Fix: store inode + ctime (or a short byte prefix at `offset - N`) with the
  cache entry; on read, verify it still matches before appending, else
  rebuild from 0. Cheap: a 64-byte `fs.read` at the cached offset.
  Proof: unit test with a temp jsonl: write 2 KB, read, truncate to 1 KB,
  write 2 KB of different lines, read again: events are the new set only.

## Phase 4 — web/Capra UI

- [x] **Tab pill swallows keyboard events from the × button** —
  `web/src/components/TabStrip.tsx:89`
  The div's `onKeyDown` preventDefaults Enter/Space for any bubbled keydown,
  including the nested `.pill-x` button, so keyboard close is impossible and
  Enter on another tab's × switches tabs.
  Fix: first line of the handler `if (e.target !== e.currentTarget) return;`.
  Proof: extend `e2e/tests/tabstrip.spec.ts`: Tab to ×, Enter → confirm
  dialog appears, no navigation.

- [x] **Middle-click on × does nothing** — `web/src/components/TabStrip.tsx:107`
  `onAuxClick={(e) => e.stopPropagation()}` on the button eats the event the
  div would have closed on; the hover text promises "middle-click or ×".
  Fix: drop the stopPropagation (let the div handle it) or call `close()`.

- [x] **Changing sort re-fetches an open file** —
  `web/src/components/FileViewer.tsx:120`
  The fetch effect depends on `order`; a sort change while a file is open
  resets info/raw and re-GETs. Fix: split the folder listing into its own
  effect keyed on `order`, or gate the dependency on `info?.kind === 'dir'`.

- [x] **TxWebView re-ships the whole transcript on status flips** —
  `mobile/src/components/TxWebView.tsx:87`
  One effect serialises `items` plus `working`/`cancellableKey`/`error`;
  any of the three changing pushes the full array through
  `injectJavaScript`. On a multi-MB session that is hundreds of ms on the
  UI thread per turn boundary.
  Fix: two effects and two message types: `{type:'items'}` only when `items`
  changes, `{type:'status', working, cancellableKey, error}` for the rest;
  the page applies status without re-diffing nodes.
  Proof: console timing in the harness pane with the kitchen-sink
  transcript; a status flip should not log an items push.

- [x] **`--public-url` drops the MagicDNS host** — `server.js:62`
  `ALLOWED_HOSTS` derives the tailnet name only from `PUBLIC_URL`, so a
  custom front plus `--host auto` answers 421 to the ts.net URL the hosting
  rule says to hand out. Fix: add `tailscaleInfo().dns` to the set
  unconditionally when tailscale is up.

## Phase 5 — hygiene

- [x] **Three copies of read/settle/send** — `server.js:486, 532, 584`
  `answerByNav`, `submitMultiSelect`, `answerGrokMenu` each redeclare the
  trio and `settle` already differs. Hoist `menuDriver(paneId, kind)` →
  `{ read, settle, send }` and the cursor `order` builder (phase 2 needs it
  in two places).
- [x] **Agent-kind lookup pasted into three branches** — `server.js:1996`
  Hoist `const kind = roster.agents.find(...)?.agent` above the answer
  branches.
- [x] **Second `.pill` block** — `web/src/style.css:1613`
  Fold `cursor: pointer; user-select: none;` into the `.pill` rule at l.1604.

## Done criteria

- `npm test` green, e2e tabstrip + transcript specs green on override ports.
- One live multi-select submit verified against claude ≥ 2.1.318 (short pane,
  Submit scrolled off) and the card clears only on a real commit.
- Bounce (`npm run build:web` + `systemctl --user restart herdr-web.service`)
  and a phone check of a long session with the HTML engine on.
- Update `review-follow-ups` memory with what shipped vs what was deferred.

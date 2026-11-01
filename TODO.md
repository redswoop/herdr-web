# herdr-web TODO

Working list for batching fixes. Each item: what's wrong, the shape of the
fix, where it lives, what's still undecided. Pick a handful, do them in one
pass, strike them off (move to Done with the commit sha).

Status tags: `[idea]` not yet shaped · `[shaped]` ready to build · `[wip]` · `[blocked]`

---

## 1. Command deck → status bar `[done 9e3bdb0 + 65c5044]` — header sub line is the status bar; deck row + Alt+digit gone (#2 revives chords)

**Problem.** The F-key deck (`1new 2rewind 3resume 4compact 5effort 6perms
7model 8context`) is a full row of buttons parked above the composer on every
claude chat. Most of the time it's noise. And half of it repeats what the
header already says: the sub line shows `model · effort · ctx · cwd`, the
AUTO chip *is* perms, and the IDLE chip is session state.

**Shape.** Collapse the deck into a thin status line whose readouts are the
controls:

| segment | shows | tap | long-press |
|---|---|---|---|
| model | `fable` | model pick list | — |
| effort | `high` | effort pick list | — |
| context | `100k ctx` | context breakdown (today's `/context`) | **compact now**, with a confirm |
| cwd | `~/src/herdr-web` | open the file browser at cwd | — |

- **perms slot goes away.** The AUTO / YOLO mode chip up top already does it.
- **new / rewind / resume** are versions of the session, not settings. They
  move under the status chip (IDLE / WORKING): tap it → small menu
  `new · rewind · resume`. That chip's already "the session's state", so the
  session's lifecycle verbs living there reads right.
- Alt+digit gets freed up for session switching (see #2); deck verbs get
  their own bindings there.
- Header sub line: once the status bar carries model/effort/ctx/cwd, the sub
  line drops them (or the status bar *is* the sub line — see open questions).

**Where.**
- web: `web/src/components/CommandDeck.tsx`, `web/src/components/AgentView.tsx`
  (header `.sub` ~L397, mode chip, status chip, deck mount ~L504)
- Capra: `mobile/src/components/CommandDeck.tsx`, `mobile/src/components/AgentHeader.tsx`
- shared: `shared/src/commands.ts` (`DECK_VERBS`, `sessionReadout`)
- manifests: `lib/adapters.js` `CLAUDE_COMMANDS`
- e2e: `e2e/tests/command-deck.spec.ts` (mock only — never test effort/model
  against real claude, it saves a default to settings.json)

**Open.**
- Status bar where: bottom (above composer, where the deck is now) or fold it
  into the header sub line and kill the bottom row entirely? Bottom is closer
  to the thumb on the phone; header saves a row.
- Phone has no long-press discoverability — does compact also need to be
  reachable from the context breakdown sheet? (Probably yes: a "compact now"
  button inside it, long-press is the shortcut.)
- Context readout could carry a fill hint (e.g. tint as it nears the window)
  so it earns its space as a status light.
- Same treatment for pi / codex / grok once their manifests land.

---

## 2. Keyboard shortcuts `[idea]`

**Want.** Alt+1…9 jumps between sessions (sidebar order), not deck slots.
Then a real keymap for the common actions: interrupt, toggle mirror, open
file browser at cwd, focus composer, new chat, the deck verbs
(model/effort/compact/rewind/resume).

**Where.** Today's Alt+digit lives in `web/src/components/CommandDeck.tsx`;
session order comes from `Sidebar.tsx`.

**Open.** A `?` cheat-sheet overlay. Don't fight the browser/OS (Alt+digit
is tab-switch in some Linux browsers? check), and nothing fires while the
composer has a modifier-free keystroke.

---

## 3. Composer button sizing `[done 5dec5a2]` — web only; Capra was already even

**Problem.** The keyboard toggle is tiny next to the huge send button; the
attach button is bigger but also off. Three buttons, three unrelated sizes.

**Shape.** One hit-target size for the secondary buttons (kbd, attach), send
stays primary but in proportion. Check web + Capra together.

**Where.** `web/src/components/Composer.tsx` (`.kbd-toggle`, `.attach`, send),
`web/src/style.css`; Capra composer in `mobile/src/components/`.

---

## 4. Model pick doesn't commit `[done a5d3266]` — bug

**Problem.** Picking a model from the deck sends `/model <alias>`, and claude
then asks which model / to confirm — but no prompt card shows up. Had to drop
to the key pad and hit Return to commit it.

**Shape.** Capture the confirm screen claude shows after `/model <alias>`
(2.1.312+) and either render it as a prompt card or auto-answer it if it's a
pure "are you sure". Use the e2e mock or snapshot/restore
`~/.claude/settings.json` — `/model` saves a default.

**Where.** `lib/adapters.js` (`CLAUDE_COMMANDS`, claude prompt detection),
`web/src/components/BlockedCard.tsx`.

---

## 5. Raw TTY from the browser/phone `[idea]`

**Want.** A real terminal on a herdr pane (xterm.js) for the stuff agents
can't do — `sudo`, interactive logins, a quick `htop`. From the phone.

**Shape.** ScreenMirror already shows the pane's screen; this is the
interactive version: xterm.js wired to the pane's pty over a websocket, or a
fresh shell pane spawned through herdr and opened in that view.

**Open — big decision.** `ARCHITECTURE.md` lists "terminal emulation" as a
**non-goal** ("a personal daemon … that *replaces* the terminal view"), so
this reverses a written decision; update the doc whichever way it goes.
Security is the other half — a shell over the network is root via sudo.
Token-required already holds off-loopback (and :7683 is on Funnel); want a
separate opt-in flag on top, maybe tailnet-only even when Funnel is on.
Phone keyboard: needs the key pad (Ctrl/Esc/Tab/arrows), which we have.

---

## 6. Desktop mode: visual compression `[idea]`

**Problem.** Desktop (wide) layout is good but loose — too much padding/
chrome for a big screen.

**Shape.** Density pass at the `WIDE` breakpoint: tighter transcript bubbles,
header, sidebar rows, docked file viewer. Needs a screenshot walkthrough
together to pick the targets.

---

## 7. File viewer: sticky headers `[done 13112d1]`

**Problem.** In a directory listing, the header (path + sort controls)
scrolls away.

**Shape.** Header row `position: sticky` (web); split it out of the
ScrollView (Capra).

**Where.** `web/src/components/FileViewer.tsx`, `mobile/src/components/FileViewer.tsx`.

---

## 8. File viewer: swipe between videos `[done 867d6a6 web, a2fb7cd Capra]` — Capra checked on Android emulator, not iOS

**Want.** Swipe to the next video in the same folder, like images.

**Shape.** Capra already has an image gallery (siblings filtered by
`IMG_RE`, swipe moves the card). Generalise it to videos (own sibling list,
pause the outgoing player). Web: arrow keys / swipe the same way.

**Where.** `mobile/src/components/FileViewer.tsx` (~L77–135 gallery),
web FileViewer.

---

## 9. File viewer: folders-first as a preference `[done 13112d1]` — in the sort menu

**Problem.** Folders always sort to the top. Armen hates it; others won't.

**Shape.** A toggle next to the name/size/date sort controls, stored with the
existing order key (`DirOrder` already round-trips through kv, same key on web
and Capra).

---

## 10. File viewer: sort by kind `[done 13112d1]` — sort is one menu (no 4th column on a phone)

**Shape.** Fourth sort key: extension/type (images, video, text, …), name
within. Goes with #9 — same `DirOrder` plumbing.

---

## 11. Markdown + code rendering in the viewer `[idea]`

**State.** `.md`/`.markdown` already render pretty by default (with a raw
toggle) on web and Capra. What's missing is syntax highlighting — in fenced
code in markdown, and for source files viewed raw.

**Shape.** A highlighter (Shiki or highlight.js) in the web viewer + the
transcript's fenced blocks; Capra needs something RN-friendly. Theme it from
the cyber palette, not the library's.

**Open.** Did a markdown file show up raw for you? If so, which one — maybe
an extension we don't sniff (`.mdx`, `README` without extension).

---

## 12. Apple Watch app — first real run `[wip]` — big

**State.** Not a branch: it's untracked `watch/` in the main checkout
(XcodeGen SwiftUI project, built 2026-10-25). Verified only in the simulator
on blackstar (`watch/sim.sh`): roster, pane tail, all 5 blocked-card kinds
from fixtures, one real send into a live claude pane. Polls (watchOS allows
no long-lived sockets), server `?lite=1` transcript keeps a poll ~14 KB.
Never been on Armen's wrist.

**To get it on the watch.**
1. Commit `watch/` (own branch or main — it touches nothing else).
2. Device install from blackstar's Xcode (signing, Series 8 paired to the
   phone). Today it's WKWatchOnly; that's fine for a first run.
3. Enrolment: today it needs server + token typed in. Real path is Capra
   handing them over via WatchConnectivity (native Swift in `mobile/ios`).
4. Then: does it feel right — crown scroll, dictation, quick replies, stop.

**Later.** Fold into Capra's EAS build as a companion target; notifications.

---

## 13. Out-of-band status: gaffer integration `[idea]` — big

**Want.** Long work an agent kicks off (renders, training, copies) lives on
gaffer's board, not in the transcript. herdr-web should show it next to the
session that started it.

**What gaffer gives us.** Controller has an HTTP API + SSE, items with a
folded progress record (`done/total/unit/phase/eta`), states incl. needs-you
/ stalled / review, and actions (`POST /api/items/ID/do`, e.g. ship). See
`~/src/gaffer/README.md`.

**Shape, in layers.**
1. **Chip it.** A gaffer item id in a transcript (`gaffer run` prints it)
   becomes a chip → item card: state, progress bar, ETA, log tail.
2. **Badge the session.** Items started from a pane's cwd/session show as a
   progress badge on its roster row + header ("2 jobs · 43%"). Needs a link
   from item → session: env var herdr sets (`HERDR_PANE`?) that `gaffer run`
   records, or match by cwd + time.
3. **Board panel.** A gaffer pane in herdr-web: needs-you first, same as
   `gaffer ls`. Actions as buttons (ship, retry, cancel) — ship still only
   on Armen's tap.
4. **Push.** Gaffer needs-you / failed through herdr-web's push (it does ntfy
   today — maybe just leave that).

**Open.** Generic "status source" adapter (gaffer first, ComfyUI queue next)
vs gaffer-specific. Controller auth/address config per host (multi-host
already fans out).

---

## 14. Multi-host on the web client `[shaped]` — big

**State.** `PLAN-MULTIHOST.md` phases 1–3 are done (blackstar node, server
whoami/link/CORS, shared + Capra). Phase 4 — web — never happened. The
plumbing it needs is mostly already shared: `shared/src/api.ts` has the
server registry, `splitHost`/`joinHost` (`w19:p1@blackstar`),
`apiUrl(path, host)`, host colours; the server answers cross-origin `/api`
with open CORS (token-gated, cookie never crosses — `server.js` ~L1610).

**What web is missing.**
- A registry the web can hold: primary = the origin it was served from
  (cookie auth, as today); extra hosts = `{baseUrl, token}` in
  `getPlatform().kv` (localStorage). Tokens in localStorage is the price.
- Settings UI: server list (add / remove / re-probe / colour) + per-host QR
  via `/api/link` — Capra's `ServerList.tsx` is the reference.
- Enrolment: paste a `capra://settings?…` link, or a "add this host" button
  when you open another host's web UI directly.
- Every web call site that still builds a bare `/api/...` URL instead of
  going through `apiUrl(path, host)`: grep `fetch(`/`EventSource(` in `web/src`.
  `FileViewer`'s `fileUrl` is one.
- SSE: `EventSource` can't send headers, so other hosts' streams go
  `?token=` — same as Capra.
- Host chip / `host` group mode / host step in the launcher (hidden with one
  server) — shared launcher model may already carry it.

**Watch for.** Mixed content — the web is served over HTTPS (Funnel/serve),
so every peer has to be HTTPS too (blackstar is, via `tailscale serve`).
The DNS-rebinding Host check (`faf129d`) is fine with a token but verify a
cross-origin no-token loopback host fails cleanly, not silently.

---

## 15. Web: rename / close sessions and workspaces `[done 96797a9]` — small

**State.** Server endpoints exist and are e2e-tested
(`POST /api/agent/:pane/rename|close`, `/api/workspace/:id/rename|close`),
and the client calls are already in `shared/src/api.ts` (`renameAgent`,
`renameWorkspace`, close…). Capra wires them to long-press on a row /
workspace header and a tap on the agent header name. Web has no UI for any
of it.

**Shape.** Click the agent name in the header → inline rename. Sidebar row
and workspace header get a `⋯` menu (and right-click) with rename / close;
close asks first. Maybe F2 = rename the current session (goes with #2).

**Where.** `web/src/components/Sidebar.tsx`, `AgentView.tsx` header,
`Overview.tsx` cards. Copy the confirm wording from `mobile/src/manage.ts`.

---

## 16. File viewer: lightbox for images + video (web) `[done 867d6a6]` — small

**Want.** An image or video in the docked side-rail viewer is postage-stamp
sized on a big screen. Click it → full-window lightbox (dimmed backdrop, Esc /
click-out closes). Pairs with #8: arrow keys step through siblings inside the
lightbox.

**Where.** `web/src/components/FileViewer.tsx` (`.file-img`, `.file-video`),
`web/src/style.css`. Video keeps its playhead when it moves into the lightbox
(reparent the element or hand over `currentTime`).

---

## 17. File viewer: home + pinned places `[done fc906d5]` — pins server-side per host (state dir), Capra ⌂ sits in the places row not the bar

**Want.** Two jumps in the viewer's header bar, always one tap away:
- **⌂ home** = the session's project root. Server resolves it: the git
  toplevel of the session cwd, falling back to the cwd itself (a session
  started in `src/foo/lib` still lands on `src/foo`). Dimmed when you're
  already there.
- **pins** = places you always want, e.g. `~/Sync` (the syncthing drop,
  present on every box). A ☆ on the current folder pins/unpins it; pins show
  as a short row/menu next to ⌂. Stored as `~/`-relative paths so one pin
  means the right folder on each host.

**Where.** `web/src/components/FileViewer.tsx`, `mobile/src/components/FileViewer.tsx`,
server for the root lookup (`git rev-parse --show-toplevel`, cached per cwd).

**Open.** Pins per device (kv, zero server work) or per host server-side
(`~/.config/herdr-web/`) so web and Capra share them. Leaning server-side:
you pin on the desktop and expect it on the phone.

---

## 18. Agent instructions: land + widen the herdr context hook `[wip — 1+3 done 591cc77; 2 blackstar install + 4 pi/codex/grok open]`

**State.** Built 2026-10-28 in another session, **uncommitted**:
`docs/agent-context.md` (path-chip rules, viewer media kinds, SendUserFile
presence, markdown that renders, phone input) and
`scripts/agent-context-hook.py` (SessionStart hook, fires when `HERDR_ENV=1`,
skips subagents, branches on the claude.ai bridge id). Installed in
`~/.claude/settings.json` on stormer and working (this session got it).
README section written too.

**To do.**
1. Commit it (docs + script + README + the `server.js` MIME comment).
2. Install on blackstar (`--install` there).
3. Teach it the things that ship next: pins/⌂ (#17), gaffer chips (#13),
   lightbox (#16) — the doc is the only place agents learn client features.
4. pi / codex / grok get nothing today. Each harness has its own
   instructions hook (pi extensions, codex `AGENTS.md`/hooks, grok ?) —
   find the equivalent or fall back to a generated `AGENTS.md` snippet.

---

## 19. Capra lanes: many JS builds in flight on one phone `[idea]` — medium

**Want.** Several work lanes (worktrees/branches: `scene`, `mobile`, main…)
each with their own Capra JS, all installable on the phone, switching
between them in a tap, without one lane's push clobbering another's.

**Today.** One TestFlight build follows one EAS channel (`production`);
`ios-update.yml` publishes only from main. A second lane means either
pushing over main's bundle or a dev client tethered to Metro.

**Shape.** Lanes = EAS Update branches, one installed native build.
- **Publish.** `ios-update.yml` on any pushed branch → `eas update --branch
  <git branch>` (channel per lane, created on first publish). Main stays
  `production`. A local `npm run lane` for unpushed worktrees.
- **Switch.** Settings → Lane picker (production + known lanes) and a deep
  link `capra://lane?branch=scene` (QR from the web, like enrolment). Uses
  expo-updates' runtime channel override, then fetch + reload. "Back to
  production" always there.
- **See it.** A lane badge in the header when you're off production, so a
  stale lane never passes for main. About row shows lane + update id.
- **Server too.** A lane usually has its own herdr-web instance (rail ran on
  :7693). The lane link can carry `server=` so switching lane also points
  at the right backend; multi-host already holds several servers.

**Limits.** Every lane must share the installed build's `runtimeVersion`.
A lane that adds a native dep can't ride OTA — it needs a `[build]`, and
until main catches up, that build breaks the others. Escape hatch for a
native-heavy lane: a second app variant (`dev.redswoop.capra.dev`, own
icon) — costs native builds against the 30/month.

**Verify first.** That expo-updates 57 lets a release build switch channel
at runtime without `disableAntiBrickingMeasures` (the API has moved across
SDKs: `setUpdateURLAndRequestHeadersOverride` vs
`setUpdateRequestHeadersOverride`). If it can't, the fallback is the
variant app or a dev-client lane.

---

## 20. Web: some chats repaint much slower than others `[idea]` — bug

**Problem.** Certain chats are visibly slow to repaint in the web UI. Example:
the ArmenSCAD setup chat (a screenful of prose dense with inline code chips).
Not reproduced or profiled yet. Armen sees it on switching into the chat too,
so it isn't only scroll paint: trace the switch (React + markdown + first
paint) as well.

**Not size.** Session file stats, 2026-10-31:

| session | file | prompts | tool_use | assistant text | `code` spans |
|---|---|---|---|---|---|
| armenscad (slow) | 4.4 MB | 2 | 69 | 5k chars | 56 |
| herdr-web | 23.2 MB | 50 | 653 | 38k | 173 |
| homarr | 22.6 MB | 76 | 387 | 62k | 187 |
| minecraft | 27.6 MB | 4 | 264 | 12k | 34 |

The slow one is the smallest on every count, so history length, tool steps and
payload don't explain it. What stands out is density: ~11 code spans per 1k
chars against 3–5 for the rest.

**Suspect (unmeasured).** Paint cost of glow on what's in the viewport. In
`web/src/theme-cyber.css` every `.msg code` gets `--glow` (two shadows, 3px +
14px blur, L479) on top of `--phosphor` on all of `.msg.assistant` (1px + 12px,
L475). A viewport of prose + chips is the worst case; chats that are mostly
collapsed pills barely pay it. Also in the mix: the 14fps rain canvas under
`.detail`, which is 93% opaque, and `backdrop-filter: blur(14px)` on the bars.
Those are the same for every chat, so they'd only amplify it.

**Measure first.** Playwright chromium with a performance trace on the mock:
one chip-dense message vs one plain, same viewport, then again with
`.msg code { text-shadow: none }`, then rain off. Paint/raster ms per frame
tells us which it is. Armen's slow case was on Brave on the Mac; check there
too, headless won't match his GPU.

**Candidate fixes.**
- Lighter chip glow (one small shadow, or none). Changes the look: Armen's call.
- `content-visibility: auto` on transcript turns. No rule like it exists today.

**Separate find.** Web never passes `tail`: `AgentView.tsx:46` calls
`useAgentSession` with no opts, so it loads the whole transcript on every open
even though the server windows it (`?tail=`, turn-aligned). Doesn't explain
this bug, since the big chats would be the slow ones, but it's a cheap win for
the 20 MB+ sessions.

---

## 21. Web: a way back to the overview `[done]` — the HERD mark goes home; `g h` waits on #2

**Problem.** The overview shown on first load (no chat open) has no way back
once a chat is open, short of editing the URL or reloading to `#`.

**Shape.** Make the HERD logo in the sidebar header go home (`location.hash =
''`, the path the mobile back button already takes in `web/src/App.tsx:116`).
Maybe `g h` or similar once #2 gives us a keymap.

**Where.** `web/src/components/Sidebar.tsx`, `web/src/App.tsx`.

---

## 22. Web: tabs for the chats in a workspace `[wip — strip landed 2026-10-31; keep-alive + sidebar next]` — big

**Want.** A browser-style tab strip over the chat: every chat in the current
workspace is one click away, the way it is in the herdr TUI. Armen calls this
huge for the web client.

**State.** The data's already here: `Agent` carries `workspaceId` + `tabId`,
the roster carries `tabs` and `workspaces`, and tab create/close/rename events
already drive it (`server.js` ~L302). The sidebar shows tab sub-rows in `space`
grouping. What's missing is the strip, and chat views that survive a switch.

**Landed (uncommitted, 2026-10-31).** `web/src/components/TabStrip.tsx` above
`AgentView` in `App.tsx`, wide only, shaped like herdr's own tab bar: dim
space name at the left (click: rename/close space), then one pill per chat in
herdr's tab order (`workspaceTabs()` in `shared/src/roster-groups.ts`,
host-scoped) — tab number + name cut at 18 chars, the full name/agent/status/
cwd on hover, the open one lit, blocked ones red. Order never shifts. ＋ aims
the launcher at the space. Right-click: rename/close; closing the open chat
lands on its neighbour. No ×. Always shown, even for a one-chat space.
Two earlier shapes rejected: a fat 34px row (too much room) and the mates
trailing the title inline (title floats, tabs reflow on switch).
Alongside: the header's `model · effort · ctx · cwd` line moved behind a
**details chip** (model + ctx on it, heat-tinted), so the bar is one line
and the `.bar` height dropped from 60 to 48px. Readouts inside are
unchanged (nested Pop). e2e: `tabstrip.spec.ts`, `command-deck.spec.ts`.
No keep-alive yet — switching still remounts.

**Shape.**
- Strip at the top of `.detail`, wide layout only: status dot, name, blocked
  marker that's loud enough to catch from another tab. Order = herdr's tab
  order, so it matches the TUI.
- `+` = new tab in this space, skipping the place picker (`SpawnTarget` with
  `workspaceId`). `×` closes, with the confirm from #15. Double-click renames.
- Sidebar click picks the workspace's last-viewed tab, or that exact chat if
  the row is a chat (see open question).
- Each tab keeps its scroll position, composer draft, and docked file.

**Keep-alive.** Today `AgentView` is `key={pane}`, so every switch tears it
down and refetches. Tabs should stay mounted so switching is instant, which
also sidesteps most of #20's slow switch. Bound it: LRU of ~4 mounted views,
and hide the rest off-DOM. Each mounted view holds an SSE stream, and plain
HTTP/1.1 caps a host at 6 connections (fine over HTTPS/h2 via `tailscale
serve`, tight on direct :7683). Wants `tail` from #20 as well.

**Where.** New `web/src/components/TabStrip.tsx`, `web/src/App.tsx` (the
`detail` block, route), `AgentView.tsx`, `Sidebar.tsx`, a pure tab-order helper
in `shared/src/roster-groups.ts` so Capra can use it later.

**Open.**
- Does the sidebar change? Either it stays as is, or it becomes a list of
  workspaces with chats living in the strip. The second is the real payoff
  and the bigger redesign.
- A strip entry per chat (agent pane) or per herdr tab? A herdr tab can hold
  several split panes. Leaning per chat, non-agent panes skipped.
- `Alt+digit`: #2 gives it to sessions in sidebar order; with tabs it should
  mean tabs in this workspace.
- Chats with no workspace mates (a one-chat space) probably hide the strip.
- Should clicking a tab also focus it in the TUI? Leaning no.

**Depends on / touches.** #15 (rename/close), #2 (keys), #20 (switch speed),
#21 (overview), #1 (the deck sits right below the strip, so count the rows).

---

## Harvested from the repo docs `[triage]`

Pulled from `PLAN.md`, `PLAN-MOBILE-REFRESH.md`, `docs/PARITY.md`, the
README roadmap and the 2026-08-06 review backlog. Spot-checked against the
code where cheap; the rest may already be done — triage before building.

**Still open (checked)**
- Push on Capra (APNs) — no `expo-notifications` in mobile. PARITY's last
  unchecked box, PLAN-MOBILE-REFRESH phase 5. Needs an APNs key.
- Collie steals from the README roadmap: triage buckets (Needs you /
  Ready·unseen / Working / Recent), "Sent ✓" trust loop, snooze,
  destructive-input confirm (pattern-match `rm`/`sudo`/force-push before
  send). None in the code.
- Capra sends `?token=` in URLs, never an `Authorization` header. Hygiene,
  not a leak: the URLs only go app → own server over HTTPS, and the server
  doesn't log them (the share-sheet leak is fixed, see Done).
- `ARCHITECTURE.md` pre-dates the monorepo (one mention of `shared/` /
  `mobile/`). (README routes: done 109f42d.)

**Probably open (from docs, not checked)**
- New-chat redesign shared by web and Capra.
- Disk cache of the last panes for Capra cold launches.
- Motion setting (full / calm / off) on Capra.
- Non-agent panes in the roster.
- Web keyboard pass leftovers — folds into #2.
- Server: adapter capabilities object (collapse the `kind === 'grok'`
  branches); session-binding memoize; tail-read for classifyBlocked on big
  session files.
- EAS: cancel-in-progress doesn't cancel queued builds; `shared/**` pushes
  burn builds.
- `committed mobile/ios` means `app.json` version/infoPlist are dead config.
- Capra alt icon / splash, chamfers, ticker / scramble leftovers (cyber skin).

---

## Done

- **Capra share sheet leaked the token** — already fixed in `9c1af7b`
  (FileViewer downloads to cache, shares the local file). Only tokened share
  left is ServerList's `capra://settings` enrolment link, which is the point.
- **Capra `useRoster()` ×6 → 6 SSE streams** — already fixed in `9c1af7b`:
  one `RosterProvider` in `boot.tsx`, every screen reads the context.

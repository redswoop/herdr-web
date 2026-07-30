# herdr-web: a real web UI over herdr agent sessions

Goal: a herdr add-on that reads TUI/agent output through herdr's socket API and
renders it as proper HTML — status chips, tappable prompts, readable transcript —
instead of an xterm-in-a-browser (ttyd). Phone-first, served over the VPN.

## Why this is tractable (verified against herdr 0.7.5, protocol 17)

herdr already does the hard parts. Its socket API (`~/.config/herdr/herdr.sock`,
JSON request/response) exposes everything needed — no terminal scraping, no pty
emulation in the browser:

- **`agent.read` / `pane.read`** — snapshot of a pane's terminal content.
  Options: `--source visible|recent|recent-unwrapped|detection`,
  `--format text|ansi`, `--lines N`. `recent-unwrapped` gives logical lines
  (good for reflowing to phone width); `ansi` keeps colors for HTML conversion.
- **`agent.prompt`** — submit a prompt to an agent directly (no keystroke faking).
- **`agent.send_keys` / `pane.send_keys` / `pane.send_text` / `pane.send_input`**
  — for answering menus/permission prompts (arrow keys, enter, y/n).
- **`agent.list` / `agent.get`** — roster with `agent_status`
  (`idle | working | blocked | done | unknown`), agent name, cwd,
  `interactive_ready`, session identity (`agent_session` id/path).
- **`session.snapshot`** — full tree: workspaces → tabs → panes, focus state,
  layout rects, and a per-pane `revision` counter (cheap change detection).
- **`events.subscribe` / `events.wait`** — the socket pushes subscription
  events; schema includes `PaneAgentStatusChangedEvent` (pane_id, workspace_id,
  agent, agent_status, state_labels, title). So "agent went blocked → push
  notification / re-render" is event-driven, not polled.
- **`agent.wait --until blocked|done|idle --timeout MS`** — CLI long-poll
  fallback if we shell out instead of speaking the socket directly.
- **`pane.wait_for_output`** — wait for regex match in pane output.
- **Plugin system**: `plugin.link/list/enable/disable`, `plugin.action.list/invoke`,
  `plugin.pane.open/focus/close`. herdr has first-class plugins — worth checking
  whether this add-on should ship AS a herdr plugin (`herdr integration --help`
  and herdr.dev docs) rather than a sidecar process.

Full machine-readable schema: `herdr api schema --json` (dumped next to this
file as `herdr-schema.json`). CLI mirrors the socket 1:1 (`herdr api snapshot`,
`herdr agent read w1:p1 --format ansi`, etc.) — good for prototyping before
writing a socket client.

## Architecture (sidecar daemon)

```
browser (phone) ──HTTP/SSE──> herdr-web daemon ──unix socket──> herdr server
                                (node or bun)      ~/.config/herdr/herdr.sock
```

1. **Daemon** connects to herdr.sock. On startup: `session.snapshot` to build the
   tree; `events.subscribe` for status changes; poll `pane.read` only for panes
   whose `revision` changed (or on event).
2. **Transcript rendering**: `agent.read --format ansi` → ANSI→HTML conversion
   server-side (e.g. `ansi_up` npm pkg, or parse SGR codes into spans directly —
   the subset agents emit is small: 16/256-color fg/bg, bold, dim, italic).
   Send rendered HTML fragments (or structured spans as JSON) to the browser
   over SSE. SSE > WebSocket here: simpler, survives proxies, and we already
   hit the Safari-WebSocket-auth bug once with ttyd.
3. **UI** (single page, no build step needed to start):
   - Roster view: one card per agent — workspace label, agent name, cwd,
     status chip (colored: blocked=red, working=amber, done=green, idle=gray).
     Sorted blocked-first. This is the phone home screen.
   - Agent view: scrollback transcript rendered as HTML, auto-follow tail,
     input box at bottom → `agent.prompt`.
   - Blocked-state affordance: when status=blocked, show quick-action buttons
     (Enter / y / n / ↑ / ↓ / Esc / ctrl+c) that map to `agent.send_keys`.
     Later: parse the visible screen for menu options ("1. Yes  2. No…") and
     render them as tappable buttons.
4. **Notifications**: on `PaneAgentStatusChangedEvent` → blocked, fire a Web
   Push notification (or at minimum badge the tab title). This is the
   /remote-control killer feature Grok lacks.
5. **Auth/exposure**: bind to VPN/LAN iface, simple bearer token in a cookie
   (avoid HTTP basic auth — Safari WebSocket/auth bug). ufw already restricts
   stormer to 192.168.4.0/22 + 10.8.0.0/24.

## Status (2026-07-30 evening)

Working v1 built and tested live: zero-dep node daemon (`server.js` +
`lib/herdr.js` socket client + `lib/adapters.js` grok/claude translators) and
vanilla-JS phone UI (`public/`). Verified end-to-end against the live grok
session: roster w/ status chips, semantic transcript (user bubbles, collapsed
thinking/tool blocks), prompt submit via `agent.prompt`, send-keys row,
blocked banner + screen peek, SSE live tail, status transitions. Run:
`node server.js --port 7683` (optional `HERDR_WEB_TOKEN` for cookie auth).
M0+M1 effectively done; next up: M2 polish (Web Push on blocked, PWA
manifest), systemd unit, Mac deployment.

Blocked-card flow added + tested live (spawned a real claude in a herdr tab,
drove AskUserQuestion and a Bash permission prompt end-to-end via the API):
- `/blocked-context` classifies: session file first (pending tool_use), then
  a generic numbered-menu screen parser (`❯ 1. Label` + indented descriptions
  + detail block above the question). Covers AskUserQuestion, permission
  prompts, and any similar TUI menu. Guard: requires the ❯ cursor so numbered
  lists in prose don't false-positive.
- `/answer` sends digit keystrokes only after verifying the expected text is
  still on screen (409 otherwise → UI falls back to raw key row).
- Key row now hidden unless blocked-with-unknown-context or ⌨-pinned.
- Finding: claude flushes the assistant tool_use to the jsonl only AFTER the
  tool resolves — so pending prompts are invisible in the session file and
  the screen parser is load-bearing, not a fallback.
- Finding: multiple claude sessions can share a cwd (e.g. background jobs);
  newest-mtime misresolves. Fixed by matching pane terminal title against
  the jsonl's `ai-title` entries, mtime as fallback.
- Digit keys select directly in claude menus (verified '1' and '3').

## Milestones

- **M0 — spike (an evening)**: shell out to `herdr` CLI from a ~200-line node
  server. `/` = roster from `herdr agent list` + `herdr api snapshot`;
  `/agent/:id` = `agent read --ansi` → ansi_up → HTML, meta-refresh every 2s.
  Ugly but proves the pipeline.
- **M1 — live**: speak the socket directly (newline-delimited JSON, `id` field
  correlates request/response; see schema). events.subscribe + SSE to browser.
  Real input: prompt box + send-keys buttons.
- **M2 — phone polish**: blocked-first roster, big tap targets, Web Push on
  blocked, dark mode.
- **M3 — maybe**: menu-option parsing into buttons; multi-host (Mac + stormer)
  by pointing the daemon at multiple sockets over SSH port-forwards, or one
  daemon per host + a tiny aggregator page.

## Decision (2026-07-30): Architecture A — the mirror

Agents keep running as TUIs in herdr panes. Adapters read *alongside*: per-agent
session files for the transcript, herdr socket for status/roster, agent.prompt/
send_keys for input. Normalized internal schema = **ACP session/update events**
(grok's updates.jsonl is already ACP; Claude Code needs a ~100-line jsonl→ACP
translator; claude-code-acp exists if we ever want to run agents headless).

Verified session-file sources (2026-07-30):
- grok: `~/.grok/sessions/<urlencoded-cwd>/<session_id>/` — `chat_history.jsonl`
  (structured turns), `updates.jsonl` (live ACP stream), `events.jsonl`
  (turn/phase telemetry). `~/.grok/active_sessions.json` maps session→pid+cwd.
- claude: `~/.claude/projects/<slugified-cwd>/<session-uuid>.jsonl`.
- Pane→session correlation: grok via pid+cwd; claude via cwd slug + newest
  mtime; check herdr `agent_session` field on claude panes (empty for grok).

## Prior art (surveyed 2026-07-30 — nothing does the semantic mirror)

- **collie** (github.com/AltanS/collie, 186★, active) — closest: PWA roster by
  status, push-on-blocked with deep link, reply box, special-keys pad, herdr
  socket one-shot JSON-RPC (matches our findings), loopback bind + any tunnel
  (Tailscale default but VPN fine). **Renders a terminal mirror, not a
  transcript** — worth installing to steal UX and validate push flow.
- **kcosr/herdr-web** (55★) — Ghostty-web full terminal emulator + Android APK;
  a better ttyd, explicitly the thing this plan rejects. Name collision with
  this repo, note.
- **Official Claude "Remote Control"** (Feb 2026, `claude remote-control` /
  `/rc`) — syncs a local Claude Code session to claude.ai/code + mobile apps
  with a real semantic UI. Claude-only, cloud-routed. Worth trying for the
  claude half; doesn't cover grok or the cross-agent roster.
- Notification-only tools: herdr-remote (menu bar/Telegram/watch approvals),
  herdr-mobile (Android), tinysend-herdr (email reply-to-unblock), ccgram
  (Telegram bridge), herdr-ntfy-notify.
- **ACP UI** (formulahendry/acp-ui) — generic ACP client (web/mobile) but
  architecture B: it *hosts* the agent, replacing the TUI. Not the mirror.

Gap we'd fill: phone-first **semantic transcript** (from session files, not
screen scrape) across grok+claude, with herdr roster/status and tappable
blocked-screen options. Nobody does the session-file trick.

## Gotchas / open questions

- ~~Wire format of the socket~~ **VERIFIED 2026-07-30** (live against 0.7.5):
  - Newline-delimited JSON. Request: `{"id":"1","method":"ping","params":{}}` —
    `params` is required even when empty. Response echoes `id`
    (`{"id":"1","result":{...}}` / `{"id":"","error":{code,message}}` — note
    malformed requests come back with empty id).
  - **One request per connection** for normal RPCs: after the first response,
    a second write on the same conn gets EPIPE. The daemon needs a
    connect-per-request helper (cheap on a unix socket), NOT a multiplexed conn.
  - **`events.subscribe` is the exception**: conn stays open and streams event
    lines (`{"event":"pane_updated","data":{...}}`) after the
    `subscription_started` ack.
  - Subscription quirks: `pane.agent_status_changed` and `pane.scroll_changed`
    require a `pane_id` (one sub entry per pane); `pane.created/closed/updated/
    agent_detected` are global. BUT `pane_updated` fires globally and its
    payload carries the full pane object incl. `revision` and `agent_status` —
    likely sufficient for change detection without per-pane subs. Re-open the
    event conn with a fresh pane list when panes come/go if per-pane subs are
    still wanted.
  - Discrepancy to watch: a `pane_updated` payload showed `agent_status:
    "unknown"` while `agent.list` said `idle` for the same pane — treat
    `agent.list`/`agent.get` as authoritative for status, events as a wake-up
    signal.
- `agent.*` targets only work once herdr *detects* an agent in the pane
  (`agent list` is empty for a plain shell). `pane.*` works on any pane —
  the daemon should fall back to pane-level for non-agent panes.
- `--source detection` is what herdr's own state detector sees — useful for
  debugging why a pane isn't detected as an agent (`herdr agent explain`).
- Scrollback depth of `recent`: unverified how many lines it retains; if too
  shallow for a full transcript, keep an append-log in the daemon keyed on
  pane revision.
- herdr is AGPL — fine for a personal tool; matters only if this ever ships.
- Check first whether the plugin system (plugin.pane.open etc.) or an existing
  community plugin already covers part of this before building the sidecar.

## Current environment (as of 2026-07-30)

- stormer: herdr 0.7.5 at ~/.local/bin/herdr, server running via systemd user
  unit `herdr.service` (lingering on). ttyd on :7682 (systemd `ttyd-herdr.service`,
  no auth, ufw-restricted) — can retire once this replaces it.
- Mac: herdr 0.7.5 via brew, server via brew services; ttyd LaunchAgent
  `com.armen.ttyd-herdr` on :7682 (basic auth, creds in the LaunchAgent — Safari
  won't work there; Chrome/Firefox only).
- agents in use: grok + claude, both machines.

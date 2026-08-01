# Architecture

The reference for how herdr-web is put together and the conventions that keep
it from sprawling. The README covers what it does and how to run it; this
covers how to change it without regretting it later.

```
phone / desktop browser
   │  HTTPS (tailscale serve)
   ▼
herdr-web daemon (server.js, zero-dep node)
   ├── unix socket ──► herdr        (roster, status, prompt, send_keys, pane.read)
   ├── session files on disk        (transcript history: ~/.claude/projects/…, ~/.grok/…)
   └── public/                      (built UI, read from disk per request)
```

## The load-bearing decision

Agent TUIs run on the terminal's alternate screen, so screen-scraping can never
recover history — one screenful is all there is. Everything follows from the
split this forces:

- **herdr socket** = *live* state: roster, status, the visible screen, and the
  input path (`agent.prompt`, `agent.send_keys`).
- **Session files** = *history*: each agent's own on-disk log, translated by a
  per-agent adapter into normalized events (an ACP-flavored internal schema).

Corollaries that keep biting people who forget them:

- Claude Code doesn't flush a `tool_use` to its jsonl until the tool
  *resolves*. Pending permission prompts are invisible in the file — that's
  why the screen-parser tier of blocked-context classification is load-bearing,
  not a fallback.
- Local TUI dialogs (`/model`, `/resume`, …) never appear in the session file
  while open. The web UI mirrors the live screen for those (ScreenMirror) and
  treats the command's record finally landing in the file as the dismiss
  signal.
- More generally, a message/tool block reaches the file only when it
  *completes* — long turns stream on the terminal minutes before the
  transcript can show them. LiveTail (the "live screen" strip while working)
  is the mitigation, not a nicety.
- Answers are verified: `POST …/answer` sends keys only if the screen still
  shows the `expect` text (409 otherwise). Never send blind keystrokes at a
  menu that may have moved.
- `agent.prompt` acking ≠ delivery. claude sometimes eats the trailing Enter
  (text stranded on the composer); a *fresh* grok TUI can drop the entire
  first prompt — `interactive_ready` flips before its input loop is live, so
  the keys vanish while the launch splash is still up. `verifyPromptLanded`
  heals both (nudge Enter / retype, never when the pane looks touched) —
  route new send paths through it, don't fire raw keystrokes and trust the ok.

## Server (`server.js` + `lib/`)

**Zero runtime dependencies, forever.** `node:` builtins only — the daemon
must run with `node server.js` on a bare node ≥ 22. npm packages are allowed
in `web/` only, where they get compiled away by the build. This is why Web
Push (VAPID + aes128gcm) is hand-rolled on `node:crypto` rather than pulling
`web-push`.

| file | job |
|---|---|
| `server.js` | HTTP routes (`/api/*`, README has the table), SSE fan-out, static serving, token/cookie auth |
| `lib/herdr.js` | herdr unix-socket client |
| `lib/adapters.js` | per-agent session-file discovery + translation to normalized events; pane→session correlation |
| `lib/notify.js` | blocked-notification lifecycle: debounce, coalesce into one slot, retract on resolve |
| `lib/webpush.js` | RFC 8291/8292/8188 crypto, validated against the RFC test vectors |

Conventions:

- `public/` is read from disk **per request** — UI rebuilds are live without a
  daemon restart. Server-side changes need a restart; the build badge in the
  header (hash of loaded server sources) tells you which world you're in.
- Server tests are `node --test test/*.test.mjs`, no framework. The push stack
  is tested end-to-end against a local fake push service, not mocked.
- New agent support = new adapter in `lib/adapters.js`: locate the session
  file for a pane, translate its records to the normalized event kinds, and
  answer "what is this agent blocked on".

## Web UI (`web/`)

React 19 + TypeScript + Vite. No CSS framework, no state library, no component
framework. `npm run build` type-checks (`tsc --noEmit`) then emits `public/`.

```
web/src/
  main.tsx, App.tsx      shell: hash routing, sidebar/detail layout
  api.ts                 the only fetch helpers (post / errorOf / agentPath)
  types.ts               mirrors the server's JSON shapes
  md.ts                  markdown → HTML for transcript/file rendering
  style.css              ALL styling, one file, section comments
  components/            feature components (Sidebar, Transcript, FileViewer…)
  components/ui/         shared UI primitives (see policy below)
  hooks/                 server-state + browser-state hooks
```

### UI-idiom policy (read before adding a widget or a dependency)

The dividing line: **does the widget contain a state machine** — pointer math,
focus traps, keyboard navigation, collision-aware positioning? Then use a
headless library. **Is it markup + CSS?** Hand-roll it; a library is more API
surface than the component.

Approved headless dependencies (unstyled, we keep our CSS):

- `react-resizable-panels` (**v4 API**: `Group`/`Panel`/`Separator`, not the
  old `PanelGroup`/`PanelResizeHandle` all the tutorials show) — via the
  `Split` wrapper in `components/ui/Split.tsx`. Don't import it directly in
  feature components.
- Radix primitives (`@radix-ui/react-*`, à la carte) — *when* we need menus /
  tooltips / popovers with real focus management. Prefer native `<dialog>` and
  the `popover` attribute first; this app only targets evergreen browsers.
- `@tanstack/react-virtual` — only if transcript length actually starts to
  chug. Not preemptively.

Explicitly out: component frameworks (MUI/Chakra/Mantine), Tailwind/shadcn,
CSS-in-JS. The dark TUI-mirror look is bespoke; fighting a theme system costs
more than it saves.

`components/ui/` is where an idiom gets written **once**: generic, no app
state, no fetching, styled by a matching section in `style.css`. Feature
components in `components/` compose them. If you're about to write a second
slightly-different chip/handle/popover, promote it to `ui/` instead.

### Styling

- One `style.css`, custom properties for the palette (`--bg`, `--surface*`,
  `--hairline`, `--accent`, `--blocked`…), `/* ---------- section ---------- */`
  comments. Find the section before adding rules.
- Phone-first. **The breakpoint is 720/721px** and it exists in two places
  that must agree: the `@media (min-width: 721px)` queries in `style.css` and
  the `WIDE` constant exported from `hooks/useMediaQuery.ts` (used wherever
  JSX branches between phone and desktop layouts). Change both or neither.
- Entrance animations are shared keyframes (`rise`, `slide-in`), ~0.18s.

### Panels & collapse — one model

Desktop is (up to) three panes: sidebar | transcript | file viewer. The rules,
applied uniformly:

- **Dragging a handle changes size.** Both edges are `Split`s
  (`herdr.split.shell` for sidebar/detail, `herdr.split.file` for
  transcript/viewer). Sizes persist per split id; double-click a handle to
  reset. Dragging never hides anything.
- **Buttons change visibility.** Sidebar « collapses to the 46px rail (»
  brings it back); the viewer ✕ closes it. Chrome visibility persists in
  localStorage (`herdr.sideHidden`); *content* visibility lives in the URL
  hash (the viewer is open iff the route says so) — deep links and back
  button stay honest.
- **Collapse state survives reload.** That includes sidebar group fold state
  (`herdr.groupsClosed`).
- On phone nothing splits: the sidebar and detail swap as full-screen pages,
  the viewer is a full-screen overlay. `useMediaQuery(WIDE)` picks the branch
  in JSX; the phone paths never mount split machinery.

### State

- **Routing is the URL hash**: `#/agent/<pane>` and
  `#/agent/<pane>/file/<path>`. Back button closes things for free; deep links
  work from push notifications. New surfaces should extend the hash route, not
  add parallel state.
- **The server is the source of truth.** Hooks wrap fetch + SSE
  (`useRoster` → `/api/roster/stream`, `useAgentSession` → per-pane event
  tail with offset resume); components render what they're given. Optimistic
  local echo (sent bubbles) reconciles against the confirmed record when it
  arrives in the session file.
- **localStorage keys are all `herdr.*`** — current registry:
  `herdr.sideHidden`, `herdr.groupBy`, `herdr.groupsClosed`,
  `herdr.fileHist.<pane>`, `herdr.split.<id>` (resizable-split layouts),
  `herdr.lastKind` (agent kind for one-click spawns), `herdr.homeView`
  (phone home surface: list | cards), `herdr.liveTail` (live TUI tail
  open | closed while an agent works).
  Add new ones to this list.
- SSE cannot report a 401, so auth is probed with a plain fetch first
  (`useRoster`) — keep that pattern for new streams.

## Testing & verification

- Server: `node --test test/*.test.mjs` from the repo root.
- UI: `npm run check` (types) is the gate; there's no component test rig yet.
  For visual verification, the daemon at :7683 serves the last build — a
  headless chromium screenshot against a real pane URL works and has been the
  practice (see dev-notes; `--timeout`, not `--virtual-time-budget`: the SSE
  stream never lets the page go idle).
- Dev loop: `cd web && npm run dev` → :5173 with HMR, `/api` proxied to :7683.
  Remember :7683's UI is stale until the next `npm run build`.

## Non-goals

Multi-tenant auth, open-internet hardening, and terminal emulation. It's a
personal daemon on a tailnet that *replaces* the terminal view; anyone who can
reach the port can drive the agents, and that's the documented deal.

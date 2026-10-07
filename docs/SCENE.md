# Scene — the plot-driven side panel

The scene is the right-hand pane of an agent view. It holds an ordered list
of **cards**, each an instance of a **plugin** with props. Nothing in the UI
decides what goes there: anything that can POST (a curl, the UI's own ×
button, the director agent) mutates a scene with ops, and every subscribed
client re-renders. LCARS rule: screens change when the story changes, so
unmount is as important as mount.

Cut one is **per pane**. Scenes are keyed by a `scope` string so the same
store can hold `ws:<id>` scenes later without the API changing.

## Running the rail instance

The rail work runs as a second herdr-web against the same herdr daemon,
with its own push state so phones don't get notified twice:

```sh
# server (from the worktree root)
HERDR_WEB_STATE=$HOME/.local/state/herdr-web-rail \
  node server.js --port 7693 --host 100.119.251.97
# vite, from web/
HERDR_API_PROXY=http://100.119.251.97:7693 \
  npx vite --host 100.119.251.97 --port 5194 --strictPort
```

Open `http://stormer.tail93d23c.ts.net:5194/#/agent/<paneId>`. The ◨ chip in
the agent header toggles the panel (desktop only; it's a third split pane
next to the transcript and the file viewer). `tools/scene-shot.mjs <out.png>`
takes a headless screenshot of pane w20:p1 for checking renders.

## HTTP API

All under `/api`, token-gated like everything else.

| Method | Path | What |
| --- | --- | --- |
| GET | `/scene-plugins` | the plugin catalog (manifests, written for the director) |
| GET | `/scene` | non-empty scopes: `{scenes:[{scope,rev,cards}]}` |
| GET | `/scene/<scope>` | snapshot `{scope, rev, cards:[Card]}` |
| GET | `/scene/<scope>/stream` | SSE: `scene` (full snapshot, on connect and every rev), `data` (`{id, data}` per source emission), `ping` |
| POST | `/scene/<scope>/ops` | apply ops; body is `{ops:[…]}`, a bare array, or one op object; returns the new snapshot |

`<scope>` is `kind:id`, url-encoded: `pane%3Aw20%3Ap1`.

### Card

```json
{ "id": "cpu", "plugin": "command-watch", "title": "CPU Tctl",
  "props": { "cmd": "sensors -j", "render": "sparkline", "parse": { "json": "k10temp-pci-00c3.Tctl.temp1_input" } },
  "data": { "at": 0, "ok": true, "value": 38.5, "history": [{ "t": 0, "v": 38.5 }] },
  "mountedAt": 0, "updatedAt": 0 }
```

`data` is the last emission from the plugin's server-side source (null for
static plugins), so late joiners get the latest reading from the snapshot.

### Ops

| op | fields | notes |
| --- | --- | --- |
| `mount` | `plugin`, `props`, `id?`, `title?`, `at?` | `id` omitted → `c<n>`; an existing `id` replaces that card in place (position kept, source restarted) |
| `update` | `id`, `props?`, `title?` | props merge shallowly; a props change restarts the source |
| `unmount` | `id` | |
| `move` | `id`, `to` | index, clamped |
| `clear` | | |

Ops in one POST are validated together before any is applied, so a bad op
rejects the whole batch (400; 404 for unknown ids, 409 when the 24-card cap
is hit). Validation checks required props, prop types, and enums from the
manifest.

## Plugins

A plugin has two halves:

- **Server** (`lib/scene.js` `PLUGINS`): a manifest (`name`, `description`,
  `props` with `type` / `required` / `enum` / `doc`) and an optional
  `source(props, emit, opts) → stop`. The source runs while the card is
  mounted, calls `emit(data)` whenever it has something, and must stop
  cleanly. `description` and the prop docs are the director's instructions:
  write them for an agent choosing what to put on stage, not for a human.
- **Client** (`web/src/scene/plugins/`): a React component `({card}) =>` that
  renders `card.props` and `card.data`. Registered by name in
  `plugins/index.tsx`. Unknown plugins render a JSON dump instead of
  crashing the panel.

### `summary`

Markdown blurb. `body` (required), `tone` ∈ info | ok | warn | bad (left
accent color). The shared md renderer is deliberately minimal: bold, code,
fences, links, headers-as-bold; no list syntax, dashes stay dashes.

### `command-watch`

`cmd` runs via `sh -c` on `interval` ms (min 1000, default 5000, 10 s
timeout, output capped at 64 KB). This is raw shell with the daemon's
privileges: on a single-user tailnet box that's by design, but the director
should prefer commands the catalog documents over invented ones.

`render`:

- `text` — tail of stdout (`lines`, default 12)
- `kv` — stdout split into `key: value` / `key=value` / `key<tab>value` rows
- `gauge` — one number with `min`/`max` bar and `warn`/`bad` thresholds
- `sparkline` — history of that number (120 points, server-side ring)

The number comes from `parse`: omit when stdout is just a number,
`{json:"a.b.0.c"}` for a dotted path into JSON stdout, `{regex:"…",group:1}`
otherwise. `unit` is a display suffix.

### `service-control`

A systemd unit as a control. `unit` (required), `scope` ∈ user (default) |
system, `interval` (min 2000, default 10000), `log` N journal lines (max 40).
The source polls `systemctl show` for load/active/sub state, pid, restart
count and uptime (from the monotonic clock, so no timestamp parsing) and
the card shows a state pill, a live uptime counter, and **restart / stop /
start buttons**. Unit names are validated against `[\w@.-]+` and run via
argv, never a shell. System-scope actions go through `sudo -n`, so they need
passwordless sudo or they fail with the error on the card.

### Card actions

Buttons are a server-side concept: a plugin manifest lists `actions`
(`name → doc`), the catalog shows them, and the UI posts

```
POST /api/scene/<scope>/cards/<id>/action   {"action":"restart"}
```

The store runs the plugin's action with the card's props, records the
result as `card.lastAction`, pushes an `action` SSE frame, and tells the
card's source to re-poll now and again 1.5 s later. The director can mount a
control but cannot press it; buttons are for humans.

### Persistence

Card lists are saved to `<state dir>/scenes.json` (debounced) on every
apply and restored on boot with their sources restarted; live data refills.
Empty scenes are not saved.

Examples that work on stormer:

```sh
S=http://100.119.251.97:7693/api/scene/pane%3Aw20%3Ap1/ops
curl -s -X POST $S -H 'content-type: application/json' -d '{"ops":[
 {"op":"mount","plugin":"summary","id":"state","title":"Where we are","props":{"body":"**Building the scene panel.**\nNext: the director."}},
 {"op":"mount","plugin":"command-watch","id":"cpu","title":"CPU Tctl","props":{"cmd":"sensors -j","interval":3000,"render":"sparkline","parse":{"json":"k10temp-pci-00c3.Tctl.temp1_input"},"unit":"°C","warn":75,"bad":88}},
 {"op":"mount","plugin":"command-watch","id":"gpu","title":"RTX 5090","props":{"cmd":"nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader,nounits","render":"gauge","unit":"°C","min":20,"max":95,"warn":75,"bad":85}}
]}'
curl -s -X POST $S -H 'content-type: application/json' -d '{"op":"unmount","id":"gpu"}'
```

## The director

The director is **stateless**. A stage manager daemon watches the whole
herd, and whenever a workspace's story moves it runs one headless
`claude -p` turn (Sonnet) from `director/stage/`, whose CLAUDE.md is the
brain and whose MCP server is the hands. The prompt carries everything the
turn needs: the panes in the workspace, the director's **own notes from last
turn**, every transcript event since it last looked, and the scene. The turn
ends by rewriting the notes. Memory is a file per workspace, cursors are
persisted, nothing replays, and cost per turn is flat.

```sh
node director/manager.mjs --api http://100.119.251.97:7693
#   --model sonnet          model for director turns
#   --only w20,w31          watch only these workspaces (verification)
#   --dry-run               log prompts, run nothing
#   --while-working 90      periodic turn (s) during a long agent turn
#   --min-gap 20            floor between turns per workspace (s)
#   --concurrency 2         max simultaneous director turns
#   --delta-chars 6000      transcript chars carried per turn (split across panes)
#   --turn-timeout 300      kill a runaway turn (s)
```

`systemd/herdr-stage-manager.service` runs it as a user unit next to
herdr-web (it points at :7683; the rail instance uses the flag above).

**Pieces:**

- `director/manager.mjs` — the stage manager. Subscribes to the roster and
  to every claude/grok pane's transcript stream. A turn is scheduled per
  **workspace** when a pane's turn ends, when the user speaks, when a pane
  appears with unseen events, and every `--while-working` seconds during a
  long turn if anything is pending. Debounced, floored by `--min-gap`,
  single-flight per workspace, `--concurrency` across workspaces. After a
  turn it mounts/updates a collapsed `director` summary card on the
  workspace scene holding the one-line reply, the notes, and running cost.
- `director/mcp.mjs` — stdio MCP server, workspace-aware: `scene_get`,
  `scene_apply`, `scene_catalog`, `transcript_tail {pane?, events}`,
  `panes`, `notes_read`, `notes_write` (≤ 40 lines, rejects longer),
  `knowledge_append` (one durable machine fact).
- `director/stage/` — the working directory of every turn. `CLAUDE.md`
  (the rules), `knowledge/stormer.md` (hand-written box facts), and
  `knowledge/learned.md` (what directors appended). Nothing else should
  ever appear there.
- `director/feeder.mjs` — the older pane-mode: a live `claude` pane in a
  backstage workspace nudged through the prompt path. Kept as a debug mode
  for when you want to argue with the director in a terminal.

**Cursors.** The transcript stream now emits an `offset` frame after each
`events` frame. The manager persists per-pane `{offset, sessionId}` in
`<state>/stage-manager.json` and reopens streams at the cursor, so a
restart feeds the director exactly what it hasn't seen. The cursor only
advances when a turn has consumed the events.

**Memory, two layers.** `<state>/director-notes/<ws>.md` is the story:
rewritten every turn, capped at 40 lines, meant to hold what is on stage and
why, what to watch, and what was decided not to show. `learned.md` is
append-only machine knowledge loaded into every turn everywhere. Both are
plain files you can read and edit.

**Scopes.** The director writes to `ws:<id>`. The web panel subscribes to
the workspace scope first and the pane scope second, so hand-mounted
pane-level cards still show under the story.

**Watch it.** The manager log shows every trigger, turn timing, step count,
and dollar cost; the `director` card on stage shows its reply and notes.

## What's next

1. Run the director against a real session, tune the rules from what it
   actually does. Add the director's notes to the scene as a collapsed
   card so its reasoning is inspectable.
2. More primitives before more bespoke plugins: `log-tail` (LiveTail exists),
   `service-control` (unit, status, restart, uptime), `file-peek`,
   `link-list`.
3. Persistence (scene survives a daemon bounce), phone layout (bottom sheet),
   `ws:` scopes with cross-pane correlation, one director per workspace.
4. Agent-authored components compiled on the fly: cut two, not cut one.

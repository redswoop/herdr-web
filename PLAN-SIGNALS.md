# Signals: the LCARS layer on herdr-web

*2026-11-05, overnight build. Vocabulary from `~/src/overseer-sketch/docs/handoff-faye.md`:
arc / scene / beat / job / signal / cover / meanwhile. This is the **signal** and
**job** half, plus the first **beat** per scene. Arcs are not here yet.*

## What exists now

```
probes (lib/probes/*.js)  ──►  store (lib/signals.js)  ──►  GET /api/signals
  disk  gpu  sys                current value per key         GET /api/signals/stream (SSE)
  gaffer  sab  services          + capped history (sparklines) POST /api/signals/act
  herd (+ lib/recap.js)          + least-squares rate          POST /api/signals  (push door)
                                   diff per source
                                                          ──►  web: Deck.tsx on the overview,
                                                               beats under session rows,
                                                               Meanwhile strip in the sidebar
```

Centrepieces, picked from a scan of the last two weeks of sessions on stormer
(herdr-web, gaffer, ComfyData, the hotbox media stack, diffusion-digest,
lora-training, upscales) and tonight's two asks:

- **Disk, live.** Every real mount (NAS double-mounts folded), free space with a
  sparkline and a rate line: *freeing 1.2 GB/min* while a cleanup runs,
  *filling … hits 20 GB in 40m* while a render writes, and *+12 GB since 21:05*.
- **Jobs.** gaffer's board as cards: needs-you first, failures with `retry`/`ack`,
  running with progress/ETA/phase, yielded with who holds the card, queued.
  Verbs fire gaffer's own API. A job whose `cwd` matches a live session gets a
  `↗ session` chip. "8 finished lately" folded under.
- **Downloads.** SAB on hotbox: speed sparkline, per-NZB bars, pause/resume,
  what landed lately. Polls every 3 s while downloading, 15 s idle.
- **Compute.** The 5090 (util sparkline, VRAM bar, who holds it) and mospeada's
  4080 via gaffer's host rows; cpu/mem for the box.
- **Services.** systemd user units, docker containers, HTTP endpoints — the
  rows that are *not* up are the content; the rest is a count.
- **Beats.** One line per live session under its row on the overview: the
  agent's last words, or the local model's two-line recap (NOW / NEXT) when
  the rules allow one. Blocked sessions lead with NEXT — the question.
- **Meanwhile strip.** Up to four chips in the sidebar footer: needs-you,
  alarms, running jobs, a disk that is moving. Visible from inside any pane.
- **Scene strip (the director).** Inside one chat, web and Capra: the two or
  three signals that belong to *that* scene, each with a caption written for it
  ("the card whose 525W cap it's checking"). Candidates are mechanical; the
  local model only ranks and captions, and says NONE when nothing belongs. A
  quiet session shows no strip. `lib/director.js`, `lib/probes/scene.js`,
  `scenes.json`.
- **Push door.** `scripts/signal.mjs` / `POST /api/signals` — any loop can
  report in; sessions are told how in `docs/agent-context.md`.

Capra has the same deck (one column, Skia sparklines, action pills) on the
cards view, beats under rows, a meanwhile strip on the list view, and the
scene strip under the agent header. `src/signals.tsx` is the one stream.

## Rules that are load-bearing

1. Probes never render; views never fetch a service. The store is the only seam.
2. A failing probe keeps its last signals and marks its source. The deck shows
   "sab failing" in the header, not a blank tile.
3. Recaps never cost VRAM: resident model only, through the arbiter, not while a
   gaffer gpu job is running/yielded here, only at act breaks, ≤ 1 per 2 min per
   pane, one in flight. Persisted per session id in `recaps.json`.
4. Pushed signals expire (default 10 min). No ghosts from dead loops.
5. Config lives in `~/.local/state/herdr-web/signals.json`, one section per
   probe id. SAB and the endpoint list are the only things that need filling in.

## Next (not tonight)

- **Arcs.** `arc_id` stamped at spawn (SessionStart hook env), the cover sorted
  needs-you first, "previously on" per arc. Beats are the raw material.
- **Attach rules.** Signal → session: a disk alarm on `/mnt/data` attaches to
  the session whose job writes there (gaffer `cwd` is the first link; a
  per-probe `attach` rule table is the general one).
- **Multi-host signals.** blackstar/mospeada each run their own store; the web
  client merges by host the way `useRoster` does.
- **Capra.** The deck as a phone screen (the overview already scales; a native
  tile set is the real job). Push notifications from signal transitions
  (needs-you, alarm) through the existing coordinator.
- **More probes.** ComfyUI queue (`/queue`, `/history`), Stash jobs (GraphQL),
  Klipper print progress, syncthing completion, Plex "now playing". (Bambu: done 2026-11-06, lib/probes/bambu.js.)
- **Gaffer on the page.** `gaffer log ID` tail in a drawer, `gaffer wait`
  semantics for a session that launched the job (beat says "waiting on #412").
- **Dismissals as rules.** A one-tap "don't show this" that writes a readable
  rule (handoff principle 10). Not built; nothing nags yet, so nothing to dismiss.

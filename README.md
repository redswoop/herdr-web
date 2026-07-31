# herdr-web 🐑

A phone-first web UI for [herdr](https://herdr.dev) agent sessions. Instead of
squinting at a terminal emulator in a browser, you get a real interface: a
roster of your agents with live status, readable transcripts, and — the whole
point — **push notifications when an agent is blocked, with the agent's actual
question and answer buttons on your lock screen**.

Zero dependencies. One `node server.js`. No build step.

## What it looks like

- **Roster** — one card per agent across all herdr workspaces, sorted
  blocked-first. Status chips: blocked (red), working (amber), done (green),
  idle (gray). Live via SSE.
- **Agent view** — the session transcript rendered semantically: your prompts
  as bubbles, assistant text as prose, thinking and tool calls as collapsed
  blocks. Auto-follows the tail. Prompt box at the bottom submits straight to
  the agent (`agent.prompt` — no keystroke faking). The phone keyboard's mic
  button gives you voice input for free.
- **Blocked cards** — when an agent stops to ask something (permission prompt,
  multiple-choice question, any numbered TUI menu), the options are parsed and
  rendered as tappable buttons. Answers are verified server-side: keys are only
  sent if the screen still shows what you think you're answering (409
  otherwise, and the UI falls back to a raw key pad: esc/↑/↓/⏎/y/n/^C).
- **Push** — when an agent blocks, your phone gets one notification carrying
  the actual question, with answer action buttons for simple choices. Resolve
  it at your desk instead and the notification retracts itself. The whole herd
  shares one notification slot (coalesced, re-rendered per change), and a
  short debounce means blocked-then-immediately-handled never buzzes you.
- **PWA** — installable to the home screen, dark, styled for notches.

## How it works

```
phone ──HTTPS (tailscale serve)──> herdr-web daemon ──unix socket──> herdr
                                        │
                                        └─── reads agent session files
                                             (~/.claude/projects/…, ~/.grok/sessions/…)
```

The trick that makes transcripts possible: agent TUIs run on the terminal's
alternate screen, so herdr's `pane.read` physically cannot scroll back — screen
scraping gets you one screenful. Instead, the daemon reads each agent's **own
session file on disk** and translates it into normalized events. herdr's socket
provides the roster, status, and input path; the session files provide the
history.

Per-agent adapters (`lib/adapters.js`):

| agent | transcript source | pane→session correlation |
|---|---|---|
| claude (Claude Code) | `~/.claude/projects/<cwd-slug>/<uuid>.jsonl` | terminal title vs the jsonl's `ai-title`, newest-mtime fallback |
| grok | `~/.grok/sessions/<cwd>/<id>/chat_history.jsonl` | live pid + cwd from `active_sessions.json` |

Blocked-context classification is two-tier: pending `tool_use` in the session
file first (AskUserQuestion / permission asks), then a generic numbered-menu
parser over the visible screen (`❯ 1. Label` + indented descriptions). The
screen parser is load-bearing, not a fallback — Claude Code doesn't flush a
tool_use to its jsonl until the tool *resolves*, so pending prompts are
invisible in the file.

Web Push is hand-rolled on `node:crypto`: VAPID (RFC 8292) + aes128gcm payload
encryption (RFC 8291/8188), validated against the RFC test vectors. VAPID keys
are auto-minted on first run into `~/.local/state/herdr-web/vapid.json` —
nothing to configure.

## Requirements

- node ≥ 22 (uses `node:` imports, top-level await; no npm packages)
- herdr ≥ 0.7.5 running with its socket at `~/.config/herdr/herdr.sock`
- for push: any HTTPS front (service workers require a secure context) —
  `tailscale serve` is the two-second option

## Run it

```sh
node server.js                      # http://0.0.0.0:7683
node server.js --port 7683 --host 127.0.0.1
HERDR_WEB_TOKEN=long-random-string node server.js   # cookie auth
```

With a token set, open `https://host/?token=…` once per device; it's stored in
an HttpOnly cookie for a year.

### As a service (systemd user unit)

```sh
cp systemd/herdr-web.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now herdr-web
```

The unit orders itself after `herdr.service`. Enable lingering
(`loginctl enable-linger $USER`) if you want it up without a login session.

### HTTPS + phone setup

```sh
tailscale serve --bg 7683       # https://<host>.<tailnet>.ts.net → localhost:7683
```

Then on the phone: open the URL, **install to home screen** (on iOS this is
required for push — 16.4+), open the installed app, tap the 🔔 bell in the
header, allow notifications. `POST /api/push/test` (or long-press the bell)
verifies the pipe.

Notes: Android Chrome caps notification action buttons at 2 (we never send
more). If push seems dead, tap the build badge in the header — it reports
secure-context and service-worker diagnostics.

## HTTP API

All under `/api`, JSON in/out. `:pane` is a herdr pane id like `w1:p2`.

| route | what |
|---|---|
| `GET /api/roster` | agent cards; `stream` variant is SSE |
| `GET /api/agent/:pane/transcript` | full translated transcript |
| `GET /api/agent/:pane/stream` | SSE tail: new events, status changes, session-rebind resets |
| `GET /api/agent/:pane/screen` | current visible pane text |
| `GET /api/agent/:pane/blocked-context` | what the agent is waiting on: `ask` / `permission` / `menu` / `unknown` / `none` |
| `POST /api/agent/:pane/prompt` | `{text}` → `agent.prompt` |
| `POST /api/agent/:pane/answer` | `{keys, expect}` → send keys only if `expect` is still on screen (409 if not) |
| `POST /api/agent/:pane/keys` | `{keys}` → raw `agent.send_keys` |
| `GET /api/push/pubkey` · `POST /api/push/subscribe` · `…/unsubscribe` · `…/test` | Web Push plumbing |

## Security model

Designed for a personal machine on a tailnet/VPN, not the open internet.
`tailscale serve` binds the HTTPS front to the tailnet only; the daemon itself
listens on `0.0.0.0` by default (use `--host 127.0.0.1` if you only reach it
through the proxy). `HERDR_WEB_TOKEN` adds a cookie gate. Anyone who can reach
the port can drive your agents — treat it accordingly.

## Development

```sh
node --test 'test/*.test.mjs'
```

The push stack is tested without a browser: a local HTTP server plays the push
service, a generated P-256 keypair plays the browser, and the tests decrypt
real aes128gcm payloads end-to-end (plus the RFC 8291 Appendix A vectors
byte-for-byte). `scripts/gen-icons.mjs` regenerates the PWA icons (zero-dep
PNG encoder, naturally).

The header shows a build badge — a hash of the server-side sources the running
process actually loaded — so you always know whether the daemon restarted after
a change. `public/` is read from disk per-request; no restart needed for UI
work.

## Prior art

[collie](https://github.com/AltanS/collie) is the closest existing tool and the
source of several ideas here (the notification debounce/coalesce/retract
lifecycle in particular — good ARCHITECTURE.md, go read it). The difference:
collie renders a terminal mirror and parses prompts client-side, so its
notifications can't say what the agent is asking. herdr-web reads session files
server-side, which is what makes the semantic transcript and
answer-from-the-lock-screen possible. Terminal-emulator-in-a-browser tools
(ttyd, kcosr/herdr-web — no relation) solve a different problem: they give you
the terminal, this replaces it.

## Status / roadmap

Working daily-driver: roster, transcripts, prompt/answer flow, push, PWA —
live-tested end-to-end against real claude and grok sessions. On the list:
triage buckets (Needs you / Ready·unseen / Working / Recent), a "Sent ✓" trust
loop, snooze, destructive-input confirmation, multi-host aggregation
(Mac + Linux box on one roster).

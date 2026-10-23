# Multi-host: one client, many herdr-web servers

Decided 2026-10-23. The client connects to N servers directly; servers stay
independent and dumb. No hub, no proxy, no cross-host id namespacing on the
server. If stormer is off, blackstar's agents are still reachable from the
phone — that's the property a hub can't give.

```
Capra / web ──HTTPS──► stormer:  server.js ── herdr.sock, ~/.claude …
            ├─HTTPS──► blackstar: server.js ── herdr.sock, ~/.claude …
            └─HTTPS──► hotbox …
```

## Addressing

- Client-side **server registry**: `[{id, name, baseUrl, token}]`. `id` is a
  short slug (the host's name from `/api/whoami`, deduped). The first entry is
  the **primary**.
- Roster entries from a non-primary server get `@<id>` appended to `paneId`,
  `workspaceId`, `tabId` (`w19:p1@blackstar`). Primary ids stay bare, so a
  one-server install (and every existing deep link, draft key, push tag) is
  untouched. Every agent/workspace/tab also carries `host: <id>`.
- `agentPath()` and the workspace verbs split the suffix and build an
  absolute URL for the right server; `apiUrl()` picks the token by matching
  the absolute URL against the registry. Call sites don't change.
- Non-agent routes (`chats`, `projects`, `sessions`, `worktrees`, `kinds`,
  `upload`, `file`, `prefs`) take a server: derived from the pane for file /
  upload / resume, chosen in the launcher for new chats, primary for prefs.

## Server (each host, unchanged protocol)

- `GET /api/whoami` → `{host, dns, build, bootedAt}`; `roster.host` carries
  the same short name.
- `GET /api/link` → the `capra://settings?server&token&name` link for THIS
  server (auth-gated: you already hold the token to call it).
- `--host auto` binds the tailscale IP (linux `tailscale`, mac app bundle),
  loopback fallback.
- CORS on `/api` (`*` + OPTIONS preflight) so the web client can reach a
  second origin; cookies never cross origins (SameSite=Strict), the token does.

## Enrolment (the "single thing I click")

`capra://settings?server=…&token=…&name=…` is **additive**: same `server` →
token/name update in place; new `server` → appended. Sources of the link:

- `npm run link` on any host (`scripts/capra-qr.mjs`): QR + link in the
  terminal; token from env / systemd drop-in / launchd plist.
- `/api/link` from an enrolled client: the web UI's settings and Capra's
  server list show each host's QR, so a second device enrols by scanning the
  first.
- Boot log prints the link.

## Client

- `useRoster()` runs one stream per server, merges, exposes per-host state
  (`hosts: [{id, name, connected, authNeeded, herdrDown, error}]`).
  `connected` = primary up; down hosts get their own pill in the list.
- Host chip on cards (hidden with one server); `host` group mode; host step at
  the front of the place-first launcher (hidden with one server).
- Settings: server list (name, url, remove, re-probe) + add form; QR per host.

## Phases

1. **blackstar node**: repo on main at `~/dev/herdr-web`, `npm ci`, web
   build, `tailscale serve --https=443 → 127.0.0.1:7683`, launchd user agent
   (`dev.redswoop.herdr-web`), retire `com.armen.ttyd-herdr`. Verify mac pane
   binding against live panes.
2. **server**: whoami, link, `--host auto`, CORS, roster.host.
3. **shared + Capra**: registry in settings-store, api addressing, roster
   merge, additive deep link, settings list, host chip/group/launcher step.
   Ships as an OTA update (no native change).
4. **web**: registry UI + token-per-server; otherwise inherits shared.
5. Later: hotbox / mospeada as peers; per-host push once Capra has push.

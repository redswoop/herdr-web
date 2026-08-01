# Web ↔ RN parity matrix

Oracle: Vite web UI (`web/`). Target: Expo RN (`mobile/`).  
E2E contract: `npm run test:e2e` (Playwright + mock API).

Legend: **done** · **partial** · **missing** · **N/A** (web-desktop only)

| Surface | Web | RN | Status | Notes |
|---|---|---|---|---|
| Token / settings auth | TokenGate | settings + gate | done | RN uses SecureStore + `?token=`; no cookie |
| Connection banner | App | index | done | |
| Roster list + group-by | Sidebar | index | done | namespaced collapse, tabs, tags, focus |
| Overview cards | Overview | Overview | done | quick-spawn + long-press customize |
| New chat launcher | NewChatDialog | NewChatSheet | done | covered by web e2e |
| Agent chrome | AgentView | agent/index | done | view-screen peek |
| Transcript | Transcript | Transcript | done | mine bubbles use MdView |
| Composer + drafts + images | Composer | Composer | done | picker vs paste intentional |
| Blocked cards | BlockedCard | BlockedCard | done | |
| Live tail | LiveTail | LiveTail | done | live screen copy + autoscroll |
| Screen mirror | ScreenMirror | ScreenMirror | done | |
| File viewer + history | FileViewer | FileViewer | done | share affordance |
| Web/native push | usePush | — | missing | P3 / remaining |
| Keyboard controller | N/A | keyboard-controller | done | needs dev build (native module) |
| Resizable splits / rail | Split | — | N/A | phone stack routes |

## RN gap checklist

- [x] Collapse keys `` `${groupBy}:${key}` ``
- [x] Tab sub-headers + focused ⌖
- [x] Session tags (starting/fresh/stateLabels)
- [x] Chip subtitle (agent · cwd)
- [x] herdrDown empty copy
- [x] Long-press ＋ → customize launcher
- [x] Overview dormant = quick-spawn; long-press customize
- [x] Blocked “view screen” peek
- [x] MineBubble → MdView
- [x] LiveTail polish
- [x] File share
- [x] keyboard-controller
- [ ] Push (APNs)

## Running tests

```sh
# unit (shared pure logic)
npm run test:unit

# e2e (starts mock :7684 + vite :5174)
npm run test:e2e

# interactive
npm run test:e2e:ui
```

Mock control plane: `POST http://127.0.0.1:7684/__mock/reset|state`, `GET …/__mock/log`.

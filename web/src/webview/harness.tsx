/* Browser stand-in for the native shell: drives the same bridge Capra will,
 * so the transcript page is iterated here (vite HMR, devtools) and only
 * verified on the phone. Open /webview.html on the dev server; /api is
 * proxied to the live daemon, so real panes replay through the real page.
 *
 *   ?pane=w3K:p1   preselect a pane      ?turns=4  stream the last 4 turns
 *   ?ms=20         gap between tail events (default 60)
 *   ?theme=cyber   skin                  ?fs=1.3   chat text size
 *   ?play=1        start the replay on load (headless screenshots)
 *   ?token=…       the daemon's HERDR_WEB_TOKEN when it wants one
 */
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  agentPath,
  applyEvents,
  configureApi,
  createAtClock,
  errorOf,
  get,
  stampEvents,
  type Agent,
  type Item,
  type Roster,
  type TEvent,
} from '@herdr/shared';
import type { Theme } from '@herdr/shared/cyber';
import { V, type HostMsg, type InitMsg, type PageMsg } from './bridge';
import { FIXTURE_EVENTS } from './fixture';

/** the synthetic pane: every node type + fixture.md's markup */
const FIXTURE = 'fixture';

const q = new URLSearchParams(location.search);
// ?token= as on the app: the daemon's token, via the dev proxy. It rides in
// `init.api` exactly as Capra sends it; the page installs the registry from
// there, so the harness's own fetches get it the same way the page's do.
const token = q.get('token');
if (token) configureApi({ token });
const sleep = (t: number) => new Promise((r) => setTimeout(r, t));

function push(msg: HostMsg) {
  window.__tx.recv(msg);
}

function Harness() {
  const [open, setOpen] = useState(true);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [pane, setPane] = useState(q.get('pane') ?? '');
  const [turns, setTurns] = useState(Number(q.get('turns')) || 2);
  const [ms, setMs] = useState(Number(q.get('ms')) || 60);
  const [theme, setTheme] = useState<Theme>(q.get('theme') === 'cyber' ? 'cyber' : 'default');
  const [fs, setFs] = useState(Number(q.get('fs')) || 1);
  const [fontScale, setFontScale] = useState(1);
  const [platform, setPlatform] = useState<InitMsg['platform']>('web');
  const [status, setStatus] = useState('idle');
  const [playing, setPlaying] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const stop = useRef(false);

  // what the page sends back — the native shell's side of the contract
  useEffect(() => {
    window.__txHost = (m: PageMsg) => {
      if (m.type === 'openUrl') window.open(m.url, '_blank', 'noopener');
      setLog((l) => [`← ${JSON.stringify(m)}`, ...l].slice(0, 30));
    };
    return () => {
      window.__txHost = undefined;
    };
  }, []);

  useEffect(() => {
    void get('/api/roster')
      .then((r) => r.json() as Promise<Roster>)
      .then((r) => setAgents(r.agents.filter((a) => a.hasTranscript)))
      .catch((e) => setStatus(`roster: ${String(e)}`));
  }, []);

  const init = () =>
    push({
      type: 'init',
      v: V,
      theme,
      roles: {},
      fs: { chat: fs, code: 1 },
      fontScale,
      platform,
      api: { baseUrl: '', token },
      paneId: pane,
      host: null,
      insetBottom: platform === 'ios' ? 20 : 0,
    });
  useEffect(init, [theme, fs, fontScale, platform, pane]);

  const autoplay = useRef(q.get('play') === '1');
  useEffect(() => {
    if (autoplay.current && pane) {
      autoplay.current = false;
      void play();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane]);

  const play = async () => {
    if (!pane) return;
    stop.current = false;
    setPlaying(true);
    let events: TEvent[];
    try {
      if (pane === FIXTURE) events = FIXTURE_EVENTS;
      else {
        const r = await get(agentPath(pane, 'transcript'));
        if (!r.ok) throw new Error(`${r.status} ${await errorOf(r)}`);
        events = ((await r.json()) as { events: TEvent[] }).events;
      }
    } catch (e) {
      setStatus(`transcript: ${String(e)}`);
      setPlaying(false);
      return;
    }
    const prompts: number[] = [];
    events.forEach((ev, i) => ev.kind === 'user' && prompts.push(i));
    const cut = prompts.length > turns ? prompts[prompts.length - turns]! : 0;
    const clock = createAtClock();
    let key = 0;
    const nextKey = () => key++;
    let items: Item[] = [];
    let working = false;
    const emit = (loaded = true) =>
      push({ type: 'state', items, loaded, error: null, working, cancellableKey: null });
    emit(false);
    await sleep(50);
    items = applyEvents(items, stampEvents(events.slice(0, cut), nextKey, clock));
    emit();
    setStatus(`history ${cut}/${events.length}`);
    await sleep(400);
    for (let i = cut; i < events.length; i++) {
      if (stop.current) break;
      const ev = events[i]!;
      if (ev.kind === 'user') {
        working = false;
        emit();
        await sleep(Math.max(ms, 16));
      }
      items = applyEvents(items, stampEvents([ev], nextKey, clock));
      if (ev.kind === 'user' || ev.kind === 'tool_use' || ev.kind === 'thought' || ev.kind === 'assistant') working = true;
      emit();
      setStatus(`${i + 1}/${events.length} ${ev.kind}`);
      await sleep(ms);
    }
    working = false;
    emit();
    setStatus(stop.current ? 'stopped' : `done · ${events.length} events`);
    setPlaying(false);
  };

  if (!open) {
    return (
      <div className="tx-harness closed">
        <div className="hz-head" onClick={() => setOpen(true)}>
          <span className={`dot ${playing ? 'on' : ''}`} /> harness
        </div>
      </div>
    );
  }
  return (
    <div className="tx-harness">
      <div className="hz-head" onClick={() => setOpen(false)}>
        <span className={`dot ${playing ? 'on' : ''}`} /> transcript harness · v{V}
      </div>
      <div className="hz-body">
        <label>
          <span>pane</span>
          <select value={pane} onChange={(e) => setPane(e.target.value)}>
            <option value="">— pick —</option>
            <option value={FIXTURE}>kitchen sink (fixture.md)</option>
            {agents.map((a) => (
              <option key={a.paneId} value={a.paneId}>
                {a.paneId} · {a.label || a.sessionTitle || a.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>turns</span>
          <input type="number" min={1} value={turns} onChange={(e) => setTurns(Number(e.target.value) || 1)} />
          <span>ms</span>
          <input type="number" min={0} value={ms} onChange={(e) => setMs(Number(e.target.value) || 0)} />
        </label>
        <div className="hz-row">
          {playing ? (
            <button onClick={() => (stop.current = true)}>stop</button>
          ) : (
            <button className="on" onClick={() => void play()} disabled={!pane}>
              replay
            </button>
          )}
          <button onClick={() => push({ type: 'scrollEnd' })}>scrollEnd</button>
          <button onClick={() => setTheme((t) => (t === 'cyber' ? 'default' : 'cyber'))} className={theme === 'cyber' ? 'on' : ''}>
            cyber
          </button>
          {(['web', 'ios', 'android'] as const).map((p) => (
            <button key={p} className={platform === p ? 'on' : ''} onClick={() => setPlatform(p)}>
              {p}
            </button>
          ))}
        </div>
        <label>
          <span>fs {fs.toFixed(2)}</span>
          <input type="range" min={0.7} max={2} step={0.05} value={fs} onChange={(e) => setFs(Number(e.target.value))} />
        </label>
        <label>
          <span>os ×{fontScale.toFixed(2)}</span>
          <input type="range" min={0.8} max={2.2} step={0.1} value={fontScale} onChange={(e) => setFontScale(Number(e.target.value))} />
        </label>
        <div className="hz-status">{status}</div>
        <div className="hz-log">{log.join('\n')}</div>
      </div>
    </div>
  );
}

export function mountHarness() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  createRoot(el).render(<Harness />);
}

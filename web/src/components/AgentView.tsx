import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { agentPath, post } from '../api';
import { useAgentMode } from '../hooks/useAgentMode';
import { useAgentSession } from '../hooks/useAgentSession';
import { useBlockedContext } from '../hooks/useBlockedContext';
import { WIDE, useMediaQuery } from '../hooks/useMediaQuery';
import type { Agent, AnswerBody, ModeState, PermissionMode, RestoredDraft, RewindState } from '../types';
import { BlockedCard } from './BlockedCard';
import { RewindCard } from './RewindCard';
import { Composer } from './Composer';
import { FileViewer } from './FileViewer';
import { LiveTail } from './LiveTail';
import { ScreenMirror } from './ScreenMirror';
import { Transcript } from './Transcript';
import { Split, SplitHandle, SplitPane } from './ui/Split';

/** lines that are TUI furniture, not command output */
const TUI_CHROME_RES = [
  /^[─═╌▔]+$/, // rules
  /^[╭╰╮╯│]/, // box borders
  /^❯/, // input line / menu cursor
  /^⏸|^⏵/, // status line
  /\? for shortcuts/,
  /esc to interrupt/,
  /^[✻✳✶✢✽]\s/, // spinner
  /^●\s+\S+ · \/effort$/, // effort chip
];
function isTuiChrome(line: string): boolean {
  return TUI_CHROME_RES.some((re) => re.test(line));
}

const MODE_LABEL: Record<ModeState, string> = {
  default: 'manual',
  acceptEdits: 'edits',
  plan: 'plan',
  auto: 'auto',
  bypassPermissions: 'bypass',
  unknown: '—',
};
const MODE_DESC: Record<PermissionMode, string> = {
  default: 'approve every tool use',
  acceptEdits: 'file edits auto-approved',
  plan: 'read-only until you approve a plan',
  auto: 'runs tools without asking',
  bypassPermissions: 'no permission checks at all',
};
const MODE_ORDER: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'];

export function AgentView({
  agent,
  file,
  onBack,
}: {
  agent: Agent | undefined;
  file: string | null;
  onBack: () => void;
}) {
  const paneId = agent?.paneId ?? '';
  const status = agent?.status;
  const { items, error, loaded, send, interrupt, cooldown, working, restoredDraft, inject } =
    useAgentSession(paneId, status, agent?.agent);
  const { ctx, refresh } = useBlockedContext(paneId, status);
  const {
    mode,
    busy: modeBusy,
    setMode,
    accept: acceptMode,
  } = useAgentMode(paneId, agent?.agent, status);
  const [modeOpen, setModeOpen] = useState(false);
  const [screen, setScreen] = useState<string | null>(null);
  // /rewind panel state, screen-parsed server-side; null = card closed
  const [rewind, setRewind] = useState<RewindState | null>(null);
  const [rewindBusy, setRewindBusy] = useState(false);
  // a conversation-restore hands back the rewound message as a composer draft
  const [rewindDraft, setRewindDraft] = useState<RestoredDraft | null>(null);
  const rewindNonce = useRef(0);
  const [keysPinned, setKeysPinned] = useState(false);
  const [keysForced, setKeysForced] = useState(false); // 409 fallback

  const openFile = useCallback(
    (p: string) => {
      location.hash = `#/agent/${encodeURIComponent(paneId)}/file/${encodeURIComponent(p)}`;
    },
    [paneId],
  );

  // per-pane stack of viewed files (resolved paths), newest first, persisted
  // so it survives reloads; x-ing an entry only forgets it, never closes
  const histKey = `herdr.fileHist.${paneId}`;
  const [fileHist, setFileHist] = useState<string[]>(() => {
    try {
      const j = JSON.parse(localStorage.getItem(histKey) ?? '[]');
      return Array.isArray(j) ? j.filter((x) => typeof x === 'string').slice(0, 30) : [];
    } catch {
      return [];
    }
  });
  const mutateHist = useCallback(
    (fn: (h: string[]) => string[]) => {
      setFileHist((h) => {
        const next = fn(h);
        try {
          localStorage.setItem(histKey, JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    [histKey],
  );
  const onFileLoaded = useCallback(
    (p: string) => mutateHist((h) => [p, ...h.filter((x) => x !== p)].slice(0, 30)),
    [mutateHist],
  );
  const forgetFile = useCallback(
    (p: string) => mutateHist((h) => h.filter((x) => x !== p)),
    [mutateHist],
  );

  const blocked = status === 'blocked';
  useEffect(() => {
    if (!blocked) {
      setKeysForced(false);
      setScreen(null);
    }
  }, [blocked]);

  useEffect(() => setRewind(null), [paneId]); // panel is per-pane TUI state

  // an interrupt-restored draft outranks a stale rewind draft
  useEffect(() => {
    if (restoredDraft) setRewindDraft(null);
  }, [restoredDraft]);

  const rewindOp = useCallback(
    async (body: { op: string; index?: number; option?: number }) => {
      const r = await post(agentPath(paneId, 'rewind'), body);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(j.error ?? r.statusText);
        setRewind(null);
        return;
      }
      if (j.step === 'list' || j.step === 'confirm') {
        setRewind(j as RewindState);
      } else {
        if (j.draft) setRewindDraft({ text: j.draft, n: rewindNonce.current++ });
        setRewind(null);
      }
    },
    [paneId],
  );

  const openRewind = useCallback(async () => {
    setRewindBusy(true);
    try {
      await rewindOp({ op: 'open' });
    } finally {
      setRewindBusy(false);
    }
  }, [rewindOp]);

  // Slash commands open local TUI dialogs (/model, /resume, …) that herdr
  // deliberately doesn't report as blocked and the session file can't see
  // until they finish. When WE sent the command, we know a dialog is (about
  // to be) up: mirror the live screen after a short delay — the delay keeps
  // instant commands from flashing it. The command's record landing in the
  // session file is the completion signal that dismisses the mirror.
  const [dialog, setDialog] = useState<{ sinceKey: number } | null>(null);
  const [poke, setPoke] = useState(0); // bumped per strip-key tap → mirror refreshes now
  const armRef = useRef<{ timer: number; sinceKey: number } | null>(null);
  // what the screen looked like before the command ran + what was typed —
  // for salvaging output of commands that never write a session-file record
  const preDialogRef = useRef<{ cmd: string; lines: Set<string> } | null>(null);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const closeDialog = useCallback(() => {
    if (armRef.current) {
      clearTimeout(armRef.current.timer);
      armRef.current = null;
    }
    setDialog(null);
  }, []);

  const sendFromComposer = useCallback(
    async (text: string) => {
      const slash = text.trim().startsWith('/');
      if (slash) {
        // baseline the screen before the command runs, so dialog residue
        // (e.g. an "Unknown command" error) can be diffed out later
        try {
          const r = await fetch(agentPath(paneId, 'screen'));
          const { text: raw } = await r.json();
          preDialogRef.current = {
            cmd: text.trim(),
            lines: new Set((raw ?? '').split('\n').map((l: string) => l.trim())),
          };
        } catch {
          preDialogRef.current = { cmd: text.trim(), lines: new Set() };
        }
      }
      await send(text);
      if (!slash) return;
      let sinceKey = -1;
      for (const it of itemsRef.current) {
        if (it.type === 'event' && it.key > sinceKey) sinceKey = it.key;
      }
      closeDialog();
      const timer = window.setTimeout(() => {
        armRef.current = null;
        setDialog({ sinceKey });
      }, 800);
      armRef.current = { timer, sinceKey };
    },
    [send, closeDialog, paneId],
  );

  // The dialog closed without ever writing a session-file record (chrome came
  // back first). Whatever it printed exists only on the TUI screen — diff
  // against the pre-command baseline and inject it as a synthetic command
  // pill so the output isn't lost (e.g. "Unknown command: /mode").
  const onDialogGone = useCallback(
    (finalScreen: string) => {
      const base = preDialogRef.current;
      preDialogRef.current = null;
      closeDialog();
      if (!base) return;
      let residue = finalScreen
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !base.lines.has(l) && !isTuiChrome(l));
      if (!residue.length) return;
      // a scrolled screen can diff in old conversation lines — keep it short
      if (residue.length > 12) residue = [...residue.slice(0, 12), '…'];
      inject([
        { kind: 'command', name: base.cmd, text: '' },
        // claude renders these as yellow bold text, not tucked-away stdout —
        // command_err renders expanded; drop the ● bullets, keep the words
        { kind: 'command_err', text: residue.map((l) => l.replace(/^●\s*/, '')).join('\n') },
      ]);
    },
    [closeDialog, inject],
  );

  // command finished (its record hit the session file) → dismiss the mirror;
  // 'user' too — custom skill commands land as a plain prompt turn
  useEffect(() => {
    const since = armRef.current?.sinceKey ?? dialog?.sinceKey;
    if (since == null) return;
    const done = items.some(
      (it) =>
        it.type === 'event' &&
        it.key > since &&
        (it.ev.kind === 'command' || it.ev.kind === 'user'),
    );
    if (done) closeDialog();
  }, [items, dialog, closeDialog]);

  useEffect(() => closeDialog, [paneId, closeDialog]);

  // the latest locally-sent bubble gets tap-to-stop while the agent works
  const cancellableKey = useMemo(() => {
    if (!working) return null;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const it = items[i];
      if (
        it.type === 'mine' &&
        (it.mine.state === 'sending' || it.mine.state === 'sent' || it.mine.state === 'confirmed')
      ) {
        return it.mine.key;
      }
    }
    return null;
  }, [items, working]);

  const onAnswer = async (body: AnswerBody) => {
    const r = await post(agentPath(paneId, 'answer'), body);
    if (r.status === 409) {
      // screen no longer shows what we thought — fall back to raw controls
      setKeysForced(true);
      alert('The screen changed — showing raw keys instead.');
      return false;
    }
    if (!r.ok) {
      alert((await r.json()).error ?? r.statusText);
      return false;
    }
    setTimeout(refresh, 600); // menu may advance to the next question
    return true;
  };

  const peekScreen = async () => {
    if (screen !== null) {
      setScreen(null);
      return;
    }
    const r = await fetch(agentPath(paneId, 'screen'));
    const { text } = await r.json();
    setScreen((text ?? '').replace(/\n{3,}/g, '\n\n').trimEnd());
  };

  const showBlockedCard = blocked && !keysForced && ctx != null && ctx.kind !== 'none' && ctx.kind !== 'unknown';
  const showKeys = keysPinned || dialog !== null || (blocked && (keysForced || ctx?.kind === 'unknown'));
  const wide = useMediaQuery(WIDE);

  const main = (
      <div className="view">
        <header className="bar">
        <button className="ghost back" aria-label="back" onClick={onBack}>
          ←
        </button>
        <div className="who">
          <div className="agent-name">
            {agent ? agent.label || agent.title || agent.paneId : paneId}
          </div>
          <div className="sub">
            {agent ? [agent.displayAgent ?? agent.agent, agent.cwd].filter(Boolean).join(' · ') : ''}
          </div>
        </div>
        {agent?.agent === 'claude' && (
          <button
            className="chip"
            title="rewind to a checkpoint"
            aria-label="rewind"
            disabled={rewindBusy || working || blocked}
            onClick={openRewind}
          >
            {rewindBusy ? '…' : '⏪'}
          </button>
        )}
        {agent?.agent === 'claude' && mode !== 'unknown' && (
          <button
            className={`chip mode-chip mode-${mode} ${modeBusy ? 'busy' : ''}`}
            disabled={modeBusy}
            onClick={() => setModeOpen((o) => !o)}
          >
            {MODE_LABEL[mode]}
          </button>
        )}
        <span className={`chip ${status ?? ''}`}>{status ?? '—'}</span>
        {modeOpen && (
          <>
            <div className="pop-backdrop" onClick={() => setModeOpen(false)} />
            <div className="mode-pop">
              {MODE_ORDER.map((m) => (
                <button
                  key={m}
                  className={`mode-row ${m === mode ? 'current' : ''}`}
                  disabled={modeBusy}
                  onClick={async () => {
                    setModeOpen(false);
                    if (m !== mode) await setMode(m);
                  }}
                >
                  <span className="mode-name">
                    {m === mode ? '❯ ' : ''}
                    {MODE_LABEL[m]}
                  </span>
                  <span className="mode-desc">{MODE_DESC[m]}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </header>

      {blocked && (
        <div className="blocked-banner">
          <span className="banner-text">agent is waiting on you</span>
          <button className="ghost" onClick={peekScreen}>
            {screen !== null ? 'hide screen' : 'view screen'}
          </button>
        </div>
      )}
      {screen !== null && <pre className="screen">{screen}</pre>}

      <Transcript
        items={items}
        error={error}
        loaded={loaded}
        working={working}
        cancellableKey={cancellableKey}
        onInterrupt={interrupt}
        onOpenFile={openFile}
      />

      {showBlockedCard && ctx && <BlockedCard ctx={ctx} onAnswer={onAnswer} />}

      {rewind && (rewind.step === 'list' || rewind.step === 'confirm') && (
        <RewindCard state={rewind} onOp={rewindOp} onClose={() => rewindOp({ op: 'cancel' })} />
      )}

      {/* session files only get content when a block completes — while the
          agent works, the live screen is the only real-time view */}
      {working && !dialog && !blocked && <LiveTail paneId={paneId} onMode={acceptMode} />}

      {dialog && (
        <ScreenMirror paneId={paneId} poke={poke} onClose={closeDialog} onGone={onDialogGone} />
      )}

      <Composer
        paneId={paneId}
        working={working}
        cooldown={cooldown}
        restoredDraft={rewindDraft ?? restoredDraft}
        showKeys={showKeys}
        onSend={sendFromComposer}
        onInterrupt={interrupt}
        onToggleKeys={() => setKeysPinned((p) => !p)}
        onKeyTap={() => setPoke((p) => p + 1)}
      />
      </div>
  );

  const viewer = file && (
    <FileViewer
      path={file}
      cwd={agent?.cwd ?? null}
      docked={wide}
      history={fileHist}
      onClose={() => {
        location.hash = `#/agent/${encodeURIComponent(paneId)}`;
      }}
      onNavigate={openFile}
      onLoaded={onFileLoaded}
      onRemoveHist={forgetFile}
    />
  );

  // wide + file open → resizable split; otherwise the viewer (if any) is a
  // fixed full-screen overlay and needs no layout slot
  if (wide && viewer) {
    return (
      <Split id="file" className="view-split">
        <SplitPane id="transcript" minSize="35%">{main}</SplitPane>
        <SplitHandle />
        <SplitPane id="viewer" defaultSize="44%" minSize={300} maxSize="70%">{viewer}</SplitPane>
      </Split>
    );
  }
  return (
    <div className="view-split">
      {main}
      {viewer}
    </div>
  );
}

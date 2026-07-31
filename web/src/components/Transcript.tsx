import { useLayoutEffect, useRef } from 'react';
import { esc, md } from '../md';
import type { Item, Mine, TEvent } from '../types';

const AUX_LABEL: Record<string, string> = {
  thought: '💭 thinking',
  tool_result: '📤 result',
  note: 'ℹ️ note',
  salvage: '⏹ salvaged from screen',
};

export function Transcript({
  items,
  error,
  cancellableKey,
  onInterrupt,
}: {
  items: Item[];
  error: string | null;
  cancellableKey: number | null; // mine bubble that gets tap-to-stop
  onInterrupt: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const follow = useRef(true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  const onScroll = () => {
    const el = ref.current;
    if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  if (error && items.length === 0) {
    return (
      <main className="scroll transcript" ref={ref}>
        <div className="empty">{error}</div>
      </main>
    );
  }

  return (
    <main className="scroll transcript" ref={ref} onScroll={onScroll}>
      {items.map((it) =>
        it.type === 'mine' ? (
          <MineBubble
            key={`m${it.mine.key}`}
            mine={it.mine}
            cancellable={it.mine.key === cancellableKey}
            onInterrupt={onInterrupt}
          />
        ) : (
          <EventNode key={`e${it.key}`} ev={it.ev} />
        ),
      )}
    </main>
  );
}

function EventNode({ ev }: { ev: TEvent }) {
  if (ev.kind === 'interrupted') {
    return <div className="interrupt-divider">⏹ interrupted</div>;
  }
  if (ev.kind === 'user') {
    return <div className="msg user" dangerouslySetInnerHTML={{ __html: md(ev.text) }} />;
  }
  if (ev.kind === 'assistant') {
    return <div className="msg assistant" dangerouslySetInnerHTML={{ __html: md(ev.text) }} />;
  }
  const body = ev.text.length > 20_000 ? `${ev.text.slice(0, 20_000)}\n… [truncated]` : ev.text;
  return (
    <details className="aux">
      <summary>
        {ev.kind === 'tool_use' ? (
          <>
            🔧 <span className="tool-name">{ev.name ?? 'tool'}</span>
          </>
        ) : (
          AUX_LABEL[ev.kind] ?? ev.kind
        )}
      </summary>
      <div className="body">
        <pre dangerouslySetInnerHTML={{ __html: esc(body) }} />
      </div>
    </details>
  );
}

const MINE_STATUS: Record<Mine['state'], string> = {
  sending: '· sending',
  sent: '✓ sent',
  confirmed: '✓',
  stopping: '⏹ interrupting…',
  stopped: '⏹ interrupted',
};

function MineBubble({
  mine,
  cancellable,
  onInterrupt,
}: {
  mine: Mine;
  cancellable: boolean;
  onInterrupt: () => void;
}) {
  return (
    <div
      className={`msg user ${cancellable ? 'cancellable' : ''}`}
      onClick={cancellable ? onInterrupt : undefined}
    >
      <span dangerouslySetInnerHTML={{ __html: md(mine.text) }} />
      <div className="sent-status">{MINE_STATUS[mine.state]}</div>
    </div>
  );
}

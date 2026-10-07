// Minimal SSE client over fetch — Node 22 has no stable global EventSource.
// Reconnects with backoff; the caller gets parsed {event, data} frames.

/** Parse one SSE frame body ("event: x\ndata: y") into {event, data}. */
export function parseFrame(raw) {
  let event = 'message';
  let fields = 0;
  const data = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      fields += 1;
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).replace(/^ /, ''));
      fields += 1;
    }
    // comments (:) and retry: are ignored
  }
  // a comment-only or retry-only block is not a frame
  return fields ? { event, data: data.join('\n') } : null;
}

/** Incremental splitter: feed chunks, get frames. Frames end at a blank line. */
export class FrameSplitter {
  constructor() {
    this.buf = '';
  }
  push(chunk) {
    this.buf += chunk;
    const frames = [];
    let i;
    while ((i = this.buf.indexOf('\n\n')) !== -1) {
      const raw = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      const f = parseFrame(raw);
      if (f) frames.push(f);
    }
    return frames;
  }
}

/**
 * Stream SSE frames from `url` forever. `onFrame({event, data})` per frame,
 * `onOpen()` on each (re)connect. Returns a stop function. A `reset` is the
 * caller's problem — we just deliver it.
 */
export function subscribe(url, { onFrame, onOpen, onError, signal, log = () => {} }) {
  let stopped = false;
  let backoff = 1000;
  const ctl = new AbortController();
  signal?.addEventListener('abort', () => ctl.abort());

  (async () => {
    while (!stopped) {
      try {
        const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'text/event-stream' } });
        if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`);
        backoff = 1000;
        onOpen?.();
        const splitter = new FrameSplitter();
        const dec = new TextDecoder();
        for await (const chunk of res.body) {
          for (const f of splitter.push(dec.decode(chunk, { stream: true }))) onFrame(f);
        }
        log(`sse closed by server: ${url}`);
      } catch (e) {
        if (stopped) break;
        onError?.(e);
        log(`sse error ${url}: ${e.message ?? e}`);
      }
      if (stopped) break;
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 15_000);
    }
  })();

  return () => {
    stopped = true;
    ctl.abort();
  };
}

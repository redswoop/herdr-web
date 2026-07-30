// herdr socket client. Verified against herdr 0.7.5 / protocol 17:
// ndjson framing, one request per connection; events.subscribe streams.
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const SOCK = process.env.HERDR_SOCK
  || path.join(os.homedir(), '.config', 'herdr', 'herdr.sock');

export class HerdrError extends Error {
  constructor(body) {
    super(body.message);
    this.code = body.code;
  }
}

export function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(SOCK);
    let buf = '';
    let settled = false;
    const fail = (err) => { if (!settled) { settled = true; sock.destroy(); reject(err); } };
    sock.setTimeout(10_000, () => fail(new Error(`herdr rpc timeout: ${method}`)));
    sock.on('error', fail);
    sock.on('connect', () => {
      sock.write(JSON.stringify({ id: '1', method, params }) + '\n');
    });
    sock.on('data', (d) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      settled = true;
      sock.destroy();
      try {
        const msg = JSON.parse(buf.slice(0, nl));
        if (msg.error) reject(new HerdrError(msg.error));
        else resolve(msg.result);
      } catch (e) { reject(e); }
    });
  });
}

// Persistent event stream. Calls onEvent(evt) per event line, onDown(err)
// when the connection drops (caller decides about reconnecting).
export function subscribe(subscriptions, onEvent, onDown) {
  const sock = net.connect(SOCK);
  let buf = '';
  let acked = false;
  sock.on('connect', () => {
    sock.write(JSON.stringify({
      id: '1', method: 'events.subscribe', params: { subscriptions },
    }) + '\n');
  });
  sock.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (!acked) {
        acked = true;
        if (msg.error) { sock.destroy(); onDown(new HerdrError(msg.error)); return; }
        continue;
      }
      onEvent(msg);
    }
  });
  sock.on('error', () => {});
  sock.on('close', () => onDown(acked ? null : new Error('subscribe closed before ack')));
  return () => sock.destroy();
}

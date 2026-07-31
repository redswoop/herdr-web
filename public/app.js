/* herdr-web frontend: roster + agent transcript over SSE. No deps. */
const $ = (id) => document.getElementById(id);
const STATUS_ORDER = { blocked: 0, working: 1, idle: 2, unknown: 3, done: 4 };

let roster = { agents: [] };
let current = null;        // paneId of open agent view
let stream = null;         // EventSource for agent view
let rosterStream = null;

// ---------- tiny markdown (escape-first, safe) ----------
function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function md(src) {
  const out = [];
  const parts = src.split(/```(\w*)\n?/);
  // parts alternate: text, lang, code, text, lang, code, ...
  for (let i = 0; i < parts.length; i += 1) {
    if (i % 3 === 2) { out.push(`<pre><code>${esc(parts[i])}</code></pre>`); continue; }
    if (i % 3 === 1) continue; // language tag
    let t = esc(parts[i]);
    t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/^### (.*)$/gm, '<strong>$1</strong>');
    t = t.replace(/^## (.*)$/gm, '<strong>$1</strong>');
    t = t.replace(/^# (.*)$/gm, '<strong>$1</strong>');
    t = t.replace(/\n/g, '<br>');
    out.push(t);
  }
  return out.join('');
}

// ---------- roster view ----------
function renderRoster() {
  const el = $('roster');
  const agents = [...roster.agents].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
  );
  if (!agents.length) {
    el.innerHTML = `<div class="empty">${roster.herdrDown ? 'herdr server unreachable' : 'no agents detected'}</div>`;
    return;
  }
  el.innerHTML = '';
  for (const a of agents) {
    const card = document.createElement('div');
    card.className = `card ${a.status}`;
    card.innerHTML = `
      <div class="info">
        <div class="title">${esc(a.agent ?? '?')} · ${esc(a.title || a.paneId)}</div>
        <div class="sub">${esc(a.cwd ?? '')}${a.hasTranscript ? '' : ' · no transcript'}</div>
      </div>
      <span class="chip ${a.status}">${esc(a.status)}</span>`;
    card.onclick = () => openAgent(a.paneId);
    el.appendChild(card);
  }
  updateBadge();
}

function updateBadge() {
  const blocked = roster.agents.filter((a) => a.status === 'blocked').length;
  document.title = blocked ? `(${blocked}) herdr` : 'herdr';
}

function connectRoster() {
  rosterStream?.close();
  rosterStream = new EventSource('/api/roster/stream');
  rosterStream.addEventListener('roster', (e) => {
    roster = JSON.parse(e.data);
    $('conn-dot').classList.toggle('ok', !roster.herdrDown);
    $('build').textContent = roster.build ?? '';
    renderRoster();
    if (current) syncAgentHeader();
  });
  rosterStream.onopen = () => $('conn-dot').classList.add('ok');
  rosterStream.onerror = () => $('conn-dot').classList.remove('ok');
}

// ---------- agent view ----------
function agentOf(paneId) { return roster.agents.find((a) => a.paneId === paneId); }

function syncAgentHeader() {
  const a = agentOf(current);
  if (!a) return;
  $('agent-name').textContent = `${a.agent} · ${a.paneId}`;
  $('agent-cwd').textContent = a.cwd ?? '';
  const chip = $('agent-status');
  chip.textContent = a.status;
  chip.className = `chip ${a.status}`;
  const blocked = a.status === 'blocked';
  $('blocked-banner').hidden = !blocked;
  if (!blocked) {
    $('screen').hidden = true;
    $('blocked-card').hidden = true;
    if (!kbdPinned) $('keysrow').hidden = true;
  } else {
    loadBlockedContext();
  }
}

// ---------- blocked cards ----------
let kbdPinned = false;
let blockedSeq = 0; // guards stale async renders

async function loadBlockedContext() {
  const paneId = current;
  const seq = ++blockedSeq;
  let ctx;
  try {
    const r = await fetch(`/api/agent/${encodeURIComponent(paneId)}/blocked-context`);
    ctx = await r.json();
  } catch { ctx = { kind: 'unknown' }; }
  if (seq !== blockedSeq || paneId !== current) return;
  renderBlockedCard(ctx);
}

function renderBlockedCard(ctx) {
  const card = $('blocked-card');
  card.innerHTML = '';
  if (ctx.kind === 'none') { card.hidden = true; return; }
  if (ctx.kind === 'unknown') {
    card.hidden = true;
    $('keysrow').hidden = false; // raw keys are the only tool we have here
    return;
  }
  card.hidden = false;
  if (!kbdPinned) $('keysrow').hidden = true;

  if (ctx.kind === 'ask') {
    // both claude and grok menus select AND submit on the digit alone
    // (verified live on both — do NOT append Enter, it would hit whatever
    // renders next)
    for (const q of ctx.questions) {
      const qEl = document.createElement('div');
      qEl.className = 'question';
      qEl.innerHTML = `<div class="q-text">${esc(q.question)}</div>`;
      q.options.forEach((opt, i) => {
        const b = document.createElement('button');
        b.className = 'option';
        b.innerHTML = `<span class="opt-label">${esc(opt.label)}</span>`
          + (opt.description ? `<span class="opt-desc">${esc(opt.description)}</span>` : '');
        b.onclick = () => answer([String(i + 1)], opt.label.slice(0, 30), b);
        qEl.appendChild(b);
      });
      if (q.multiSelect) {
        const done = document.createElement('button');
        done.className = 'option confirm';
        done.textContent = 'done ⏎ (multi-select: taps toggle)';
        done.onclick = () => answer(['Enter'], null, done);
        qEl.appendChild(done);
      }
      card.appendChild(qEl);
    }
    return;
  }

  if (ctx.kind === 'menu') {
    const qEl = document.createElement('div');
    qEl.className = 'question';
    qEl.innerHTML = (ctx.detail ? `<pre class="perm-detail">${esc(ctx.detail)}</pre>` : '')
      + `<div class="q-text">${esc(ctx.question || ctx.header || 'choose an option')}</div>`;
    for (const opt of ctx.options) {
      const b = document.createElement('button');
      b.className = 'option';
      b.innerHTML = `<span class="opt-label">${opt.selected ? '❯ ' : ''}${esc(opt.label)}</span>`
        + (opt.description ? `<span class="opt-desc">${esc(opt.description)}</span>` : '');
      b.onclick = () => answer([String(opt.n)], opt.label.slice(0, 30), b);
      qEl.appendChild(b);
    }
    card.appendChild(qEl);
    return;
  }

  if (ctx.kind === 'permission') {
    const qEl = document.createElement('div');
    qEl.className = 'question';
    const detail = (ctx.detail ?? '').slice(0, 2000);
    qEl.innerHTML = `<div class="q-text">🔒 wants to run <span class="tool-name">${esc(ctx.tool)}</span></div>`
      + (detail ? `<pre class="perm-detail">${esc(detail)}</pre>` : '');
    const mk = (label, keys, cls = '') => {
      const b = document.createElement('button');
      b.className = `option ${cls}`;
      b.textContent = label;
      b.onclick = () => answer(keys, null, b);
      qEl.appendChild(b);
    };
    mk('Yes, allow', ['1'], 'confirm');
    mk('Yes, don’t ask again', ['2']);
    mk('No / tell it what to do', ['3'], 'deny');
    card.appendChild(qEl);
  }
}

async function answer(keys, expect, btn) {
  if (!current) return;
  btn?.classList.add('busy');
  try {
    const r = await fetch(`/api/agent/${encodeURIComponent(current)}/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keys, expect }),
    });
    if (r.status === 409) {
      // screen no longer shows what we thought — fall back to raw controls
      $('keysrow').hidden = false;
      $('blocked-card').hidden = true;
      alert('The screen changed — showing raw keys instead.');
      return;
    }
    if (!r.ok) alert((await r.json()).error ?? r.statusText);
    setTimeout(loadBlockedContext, 600); // menu may advance to next question
  } finally {
    btn?.classList.remove('busy');
  }
}

function eventNode(ev) {
  if (ev.kind === 'user') {
    const d = document.createElement('div');
    d.className = 'msg user';
    d.innerHTML = md(ev.text);
    return d;
  }
  if (ev.kind === 'assistant') {
    const d = document.createElement('div');
    d.className = 'msg assistant';
    d.innerHTML = md(ev.text);
    return d;
  }
  const det = document.createElement('details');
  det.className = 'aux';
  const label = {
    thought: '💭 thinking',
    tool_use: `🔧 <span class="tool-name">${esc(ev.name ?? 'tool')}</span>`,
    tool_result: '📤 result',
    note: 'ℹ️ note',
  }[ev.kind] ?? esc(ev.kind);
  const body = ev.text.length > 20_000 ? ev.text.slice(0, 20_000) + '\n… [truncated]' : ev.text;
  det.innerHTML = `<summary>${label}</summary><div class="body"><pre>${esc(body)}</pre></div>`;
  return det;
}

function nearBottom(el) { return el.scrollHeight - el.scrollTop - el.clientHeight < 120; }

function appendEvents(events) {
  const t = $('transcript');
  const follow = nearBottom(t);
  for (const ev of events) t.appendChild(eventNode(ev));
  if (follow) t.scrollTop = t.scrollHeight;
}

async function openAgent(paneId) {
  current = paneId;
  location.hash = `#/agent/${encodeURIComponent(paneId)}`;
  $('roster-view').hidden = true;
  $('agent-view').hidden = false;
  $('transcript').innerHTML = '';
  $('screen').hidden = true;
  $('blocked-card').hidden = true;
  syncAgentHeader();
  try {
    const r = await fetch(`/api/agent/${encodeURIComponent(paneId)}/transcript`);
    if (!r.ok) throw new Error((await r.json()).error);
    const { events, offset } = await r.json();
    appendEvents(events);
    $('transcript').scrollTop = $('transcript').scrollHeight;
    connectAgentStream(paneId, offset);
  } catch (e) {
    $('transcript').innerHTML = `<div class="empty">${esc(String(e.message ?? e))}</div>`;
    // fresh sessions take a moment to grow a transcript file — retry
    setTimeout(() => { if (current === paneId && !stream) openAgent(paneId); }, 2500);
  }
}

function connectAgentStream(paneId, offset) {
  stream?.close();
  stream = new EventSource(`/api/agent/${encodeURIComponent(paneId)}/stream?offset=${offset}`);
  stream.addEventListener('events', (e) => appendEvents(JSON.parse(e.data)));
  stream.addEventListener('status', () => syncAgentHeader());
  stream.addEventListener('reset', () => {
    // server re-resolved to a different session file — reload transcript
    stream?.close();
    stream = null;
    if (current === paneId) openAgent(paneId);
  });
}

function closeAgent() {
  stream?.close();
  stream = null;
  current = null;
  location.hash = '';
  $('agent-view').hidden = true;
  $('roster-view').hidden = false;
}

// ---------- input ----------
async function api(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) alert((await r.json()).error ?? r.statusText);
}

$('send').onclick = async () => {
  const text = $('prompt').value.trim();
  if (!text || !current) return;
  $('send').disabled = true;
  await api(`/api/agent/${encodeURIComponent(current)}/prompt`, { text });
  $('send').disabled = false;
  $('prompt').value = '';
  $('prompt').style.height = 'auto';
};

$('prompt').addEventListener('input', function grow() {
  this.style.height = 'auto';
  this.style.height = `${Math.min(this.scrollHeight, innerHeight * 0.3)}px`;
});
$('prompt').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('send').click();
});

for (const btn of document.querySelectorAll('#keysrow button')) {
  btn.onclick = () => current
    && api(`/api/agent/${encodeURIComponent(current)}/keys`, { keys: [btn.dataset.keys] });
}

$('show-screen').onclick = async () => {
  const scr = $('screen');
  if (!scr.hidden) { scr.hidden = true; return; }
  const r = await fetch(`/api/agent/${encodeURIComponent(current)}/screen`);
  const { text } = await r.json();
  scr.textContent = (text ?? '').replace(/\n{3,}/g, '\n\n').trimEnd();
  scr.hidden = false;
};

$('back').onclick = closeAgent;
$('build').onclick = () => {
  const secure = window.isSecureContext;
  alert([
    `server build: ${roster.build ?? '?'}`,
    `booted: ${roster.bootedAt ?? '?'}`,
    `secure context: ${secure} ${secure ? '' : '(push/PWA need HTTPS)'}`,
    `service worker: ${'serviceWorker' in navigator}`,
    `push API: ${'PushManager' in window}`,
  ].join('\n'));
};
$('kbd-toggle').onclick = () => {
  kbdPinned = !kbdPinned;
  $('keysrow').hidden = !kbdPinned && agentOf(current)?.status !== 'blocked';
  if (kbdPinned) $('keysrow').hidden = false;
};

// ---------- push ----------
let swReg = null;

function b64uToBytes(s) {
  const raw = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function syncBell() {
  const bell = $('bell');
  if (!swReg?.pushManager) return; // no SW / no push support — bell stays hidden
  bell.hidden = false;
  const sub = await swReg.pushManager.getSubscription();
  bell.textContent = sub ? '🔔' : '🔕';
  bell.classList.toggle('on', !!sub);
}

async function initPush() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swReg = await navigator.serviceWorker.register('/sw.js');
    await syncBell();
  } catch { /* http origin or private mode — feature stays off */ }
}

$('bell').onclick = async () => {
  if (!swReg) return;
  const existing = await swReg.pushManager.getSubscription();
  if (existing) {
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: existing.endpoint }),
    });
    await existing.unsubscribe();
    return syncBell();
  }
  if (Notification.permission === 'denied') {
    alert('Notifications are blocked for this site — enable them in browser settings.');
    return;
  }
  try {
    const { key } = await (await fetch('/api/push/pubkey')).json();
    const sub = await swReg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64uToBytes(key),
    });
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
  } catch (e) {
    alert(`push setup failed: ${e.message ?? e}`);
  }
  syncBell();
};

// ---------- boot ----------
connectRoster();
initPush();
addEventListener('hashchange', () => {
  const m = location.hash.match(/^#\/agent\/(.+)$/);
  if (!m && current) closeAgent();
});
(async () => {
  // initial roster fetch so deep links work before the SSE lands
  try { roster = await (await fetch('/api/roster')).json(); renderRoster(); } catch {}
  const m = location.hash.match(/^#\/agent\/(.+)$/);
  if (m) openAgent(decodeURIComponent(m[1]));
})();

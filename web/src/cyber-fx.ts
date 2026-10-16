/* Cyber theme effects that CSS can't do alone: digital rain behind the HUD,
   decrypt-scramble on titles as they mount, and the boot log. All of it is
   decoration — pointer-events none, paused when hidden, off under
   prefers-reduced-motion, and torn down completely on jack-out. */

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let rain: { stop: () => void } | null = null;
let observer: MutationObserver | null = null;

export function startCyberFx() {
  if (reduced()) return;
  if (!rain) rain = startRain();
  if (!observer) observer = startScramble();
}

export function stopCyberFx() {
  rain?.stop();
  rain = null;
  observer?.disconnect();
  observer = null;
}

/* ---------------- digital rain ---------------- */

const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜ0123456789ABCDEF<>/\\=+*';
const pick = (s: string) => s[(Math.random() * s.length) | 0];

/** follows the user's palette (prefs.ts); streams are the primary, rare
 *  "hot" ones lean amber */
let palette = { stream: '#ff6a5c', head: '#ffd9d0', hot: '#ffb070', hotHead: '#ffe6c8' };
export function setRainColors(p: typeof palette) {
  palette = p;
}

function startRain() {
  const c = document.createElement('canvas');
  c.className = 'cy-rain';
  c.setAttribute('aria-hidden', 'true');
  document.body.prepend(c);
  const g = c.getContext('2d')!;
  const COL = 18;
  let drops: { y: number; speed: number; hot: boolean }[] = [];
  const size = () => {
    // 1x backing store on purpose: soft glyphs, cheap fills
    c.width = innerWidth;
    c.height = innerHeight;
    drops = Array.from({ length: Math.ceil(c.width / COL) }, () => ({
      y: Math.random() * (c.height / COL) * 1.2 - 4, // mid-fall at boot, not empty sky
      speed: 0.6 + Math.random() * 1.1,
      hot: Math.random() < 0.08,
    }));
  };
  size();
  addEventListener('resize', size);

  let last = 0;
  let raf = 0;
  const frame = (t: number) => {
    raf = requestAnimationFrame(frame);
    if (document.hidden || t - last < 70) return; // ~14fps is plenty for ambience
    last = t;
    // fade toward transparent so the page's own background shows through
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-over';
    g.font = `14px "Share Tech Mono", monospace`;
    drops.forEach((d, i) => {
      const x = i * COL;
      const y = d.y * COL;
      g.fillStyle = d.hot ? palette.hot : palette.stream;
      g.globalAlpha = 0.55;
      g.fillText(pick(GLYPHS), x, y - COL);
      g.globalAlpha = 1;
      g.fillStyle = d.hot ? palette.hotHead : palette.head;
      g.fillText(pick(GLYPHS), x, y);
      d.y += d.speed;
      if (y > c.height + COL * 4 && Math.random() > 0.97) {
        d.y = 0;
        d.speed = 0.6 + Math.random() * 1.1;
        d.hot = Math.random() < 0.08;
      }
    });
  };
  raf = requestAnimationFrame(frame);
  return {
    stop() {
      cancelAnimationFrame(raf);
      removeEventListener('resize', size);
      c.remove();
    },
  };
}

/* ---------------- decrypt scramble ---------------- */

const SCRAMBLE_SEL = '.bar h1, .agent-name, .session .title, .ov-card-title, .modal-head h2, .group-title, .nc-where-name';
const NOISE = '!<>-_\\/[]{}=+*^?#01ｱｲｳｴｵ';
const seen = new WeakSet<Element>();

function startScramble() {
  const scan = (root: ParentNode) => {
    root.querySelectorAll(SCRAMBLE_SEL).forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      scramble(el);
    });
  };
  scan(document);
  const mo = new MutationObserver((muts) => {
    for (const m of muts)
      m.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        const el = n as Element;
        if (el.matches(SCRAMBLE_SEL)) {
          if (!seen.has(el)) {
            seen.add(el);
            scramble(el);
          }
        }
        scan(el);
      });
  });
  mo.observe(document.body, { childList: true, subtree: true });
  return mo;
}

/** decode each text node from noise to its real text. React owns these
 *  nodes, so if it writes mid-animation we notice and stand down. */
export function scramble(el: Element, ms = 650) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  nodes.forEach((node) => {
    const final = node.data;
    if (!final.trim() || final.length > 120) return;
    const reveal = [...final].map((_, i) => (i / final.length) * ms * 0.6 + Math.random() * ms * 0.4);
    let written = final;
    const t0 = performance.now();
    const step = (t: number) => {
      if (node.data !== written) return; // React re-rendered it — theirs now
      const e = t - t0;
      if (e >= ms) {
        node.data = written = final;
        return;
      }
      written = [...final].map((ch, i) => (ch === ' ' || e >= reveal[i] ? ch : pick(NOISE))).join('');
      node.data = written;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/* ---------------- boot log ---------------- */

export function bootLog({ short = false } = {}) {
  if (reduced()) return;
  const h = location.hostname || 'localhost';
  const host = /^[\d.]+$/.test(h) ? h : `${h.split('.')[0]}.tailnet`;
  const lines = short
    ? ['> neural link .......... OK', '> ICE .................. BYPASSED', 'JACKED IN']
    : [
        'HERDR//OS 20.77 — NETRUNNER EDITION',
        `> handshake ${host} .... OK`,
        '> decrypting roster ........... OK',
        '> ICE countermeasures ......... BYPASSED',
        '> waking the herd ............. 🐑',
        'WELCOME BACK, RUNNER',
      ];
  const el = document.createElement('div');
  el.className = 'cy-boot';
  el.setAttribute('aria-hidden', 'true');
  const pre = document.createElement('pre');
  el.appendChild(pre);
  document.body.appendChild(el);
  const done = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 450);
  };
  el.addEventListener('pointerdown', done); // tap to skip
  let li = 0;
  const per = short ? 130 : 170;
  const tick = () => {
    if (li >= lines.length) {
      setTimeout(done, short ? 250 : 450);
      return;
    }
    const line = lines[li++];
    const div = document.createElement('div');
    if (li === lines.length) div.className = 'last';
    pre.appendChild(div);
    div.textContent = line;
    scramble(div, per * 1.6);
    setTimeout(tick, per);
  };
  tick();
}

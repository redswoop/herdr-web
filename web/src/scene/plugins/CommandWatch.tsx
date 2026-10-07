import { useEffect, useId, useState } from 'react';
import type { WatchData } from '../types';
import type { CardProps } from './index';

function num(v: unknown, dflt: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}
function str(v: unknown, dflt = ''): string {
  return typeof v === 'string' ? v : dflt;
}
function opt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** "3s ago" that re-renders itself every second */
function Ago({ at }: { at: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  return <span className="scene-ago">{s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`}</span>;
}

function fmt(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
}

/** lo / mid / hi: thresholds when given, else position in [min, max] */
function level(v: number, { min, max, warn, bad }: { min: number; max: number; warn?: number; bad?: number }): 'lo' | 'mid' | 'hi' {
  if (bad != null || warn != null) {
    if (bad != null && v >= bad) return 'hi';
    if (warn != null && v >= warn) return 'mid';
    return 'lo';
  }
  const f = (v - min) / (max - min || 1);
  return f >= 0.85 ? 'hi' : f >= 0.6 ? 'mid' : 'lo';
}

const LVL: Record<'lo' | 'mid' | 'hi', string> = { lo: 'var(--lo)', mid: 'var(--mid)', hi: 'var(--hi)' };

function scaleOf(card: CardProps['card']) {
  return {
    min: num(card.props.min, 0),
    max: num(card.props.max, 100),
    warn: opt(card.props.warn),
    bad: opt(card.props.bad),
  };
}

/** btop's `Used: 81% ▰▰▰▰▱▱ 273 GiB` row */
function Meter({ card, d }: { card: CardProps['card']; d: WatchData }) {
  const sc = scaleOf(card);
  const unit = str(card.props.unit);
  if (d.value == null) return <div className="scene-nodata">no number in output</div>;
  const pct = Math.max(0, Math.min(1, (d.value - sc.min) / (sc.max - sc.min || 1)));
  const lvl = level(d.value, sc);
  const flat = sc.warn == null && sc.bad == null && card.props.flat === true;
  return (
    <div className={`sc-meter lvl-${lvl}`}>
      <span className="k">{str(card.props.label, 'now')}</span>
      <span className="pct">{Math.round(pct * 100)}%</span>
      <span className={`sc-bar ${flat ? 'flat' : ''}`} style={{ ['--pct' as string]: `${pct * 100}%` }}>
        <span className="track" />
        <span className="cover" />
      </span>
      <span className="val">
        {fmt(d.value)}
        {unit}
      </span>
    </div>
  );
}

/** btop's dotted history graph: one column per sample, colored by value */
function DotGraph({ card, d }: { card: CardProps['card']; d: WatchData }) {
  const uid = useId().replace(/:/g, '');
  const h = d.history ?? [];
  const sc = scaleOf(card);
  const unit = str(card.props.unit);
  if (!h.length) return <div className="scene-nodata">waiting for a number…</div>;
  const W = 240;
  const H = 40;
  const COL = 3; // 2px dot + 1px gap
  const cols = Math.floor(W / COL);
  const shown = h.slice(-cols);
  const vs = shown.map((p) => p.v);
  const dlo = Math.min(...vs);
  const dhi = Math.max(...vs);
  // y-scale to the data with a little headroom: the graph is for seeing
  // movement; the color carries the absolute level
  const pad = (dhi - dlo || Math.abs(dhi) * 0.05 || 1) * 0.15;
  const lo = dlo - pad;
  const span = dhi + pad - lo || 1;
  const last = shown[shown.length - 1];
  const lvl = level(last.v, sc);
  return (
    <div className="scene-graph">
      <div className="sc-graph-head">
        <span className={`now ${lvl}`}>{fmt(last.v)}</span>
        <span className="unit">{unit}</span>
        <span className="range">
          {fmt(dlo)}–{fmt(dhi)}
          {unit} · {h.length}pt
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="sc-graph" aria-hidden>
        <defs>
          <pattern id={`dots-${uid}`} width="3" height="3" patternUnits="userSpaceOnUse">
            <rect width="2" height="2" fill="#fff" />
          </pattern>
          <mask id={`m-${uid}`}>
            <rect width={W} height={H} fill={`url(#dots-${uid})`} />
          </mask>
        </defs>
        <g mask={`url(#m-${uid})`}>
          {shown.map((p, i) => {
            const hh = Math.max(2, ((p.v - lo) / span) * H);
            const x = W - (shown.length - i) * COL; // right-aligned, newest at the edge
            return <rect key={i} x={x} y={H - hh} width={2} height={hh} fill={LVL[level(p.v, sc)]} />;
          })}
        </g>
      </svg>
    </div>
  );
}

function Kv({ d }: { d: WatchData }) {
  const rows = d.kv ?? [];
  if (!rows.length) return <div className="scene-nodata">(no output)</div>;
  return (
    <div className="sc-rows">
      {rows.map(([k, v], i) => (
        <div className="sc-row" key={i}>
          <span className="k">{k}</span>
          <span className="v">{v}</span>
        </div>
      ))}
    </div>
  );
}

function Text({ card, d }: { card: CardProps['card']; d: WatchData }) {
  const lines = num(card.props.lines, 12);
  const out = (d.out || d.err || '').replace(/\s+$/, '');
  const all = out.split('\n');
  const shown = all.length > lines ? all.slice(-lines) : all;
  return (
    <pre className="scene-text">
      {all.length > lines ? `… ${all.length - lines} more\n` : ''}
      {shown.join('\n') || '(no output)'}
    </pre>
  );
}

/** `command-watch`: the server runs the command; this just draws `data`. */
export function CommandWatch({ card }: CardProps) {
  const d = card.data as WatchData | null;
  const render = str(card.props.render, 'text');
  const cmd = str(card.props.cmd);
  return (
    <div className="scene-watch">
      {!d ? (
        <div className="scene-nodata">running…</div>
      ) : render === 'gauge' ? (
        <Meter card={card} d={d} />
      ) : render === 'sparkline' ? (
        <DotGraph card={card} d={d} />
      ) : render === 'kv' ? (
        <Kv d={d} />
      ) : (
        <Text card={card} d={d} />
      )}
      <div className="scene-watch-foot">
        <code className="scene-cmd" title={cmd}>{cmd}</code>
        {d && (
          <span className={`scene-watch-status ${d.ok ? 'ok' : 'bad'}`}>
            {d.timedOut ? 'timeout ' : d.ok ? '' : `exit ${d.code} `}
            <Ago at={d.at} />
          </span>
        )}
      </div>
      {d && !d.ok && d.err && <pre className="scene-text scene-err">{d.err.trim()}</pre>}
    </div>
  );
}

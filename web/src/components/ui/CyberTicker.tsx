import { useEffect, useState } from 'react';
import type { Roster } from '../../types';

const FLAVOR = [
  'NETWATCH: NO INTRUSIONS',
  'ICE STATUS: NOMINAL',
  'ALL DAEMONS ACCOUNTED FOR',
  'SHEEP COUNT VERIFIED',
  'CHOOM, HYDRATE',
];

/** cyber-only footer marquee: live roster stats dressed up as a newsfeed.
 *  Content is doubled so the -50% scroll loops seamlessly. */
export function CyberTicker({ roster, connected }: { roster: Roster; connected: boolean }) {
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const n = (s: string) => roster.agents.filter((a) => a.status === s).length;
  const blocked = n('blocked');
  const items = [
    connected ? 'UPLINK ◉ LIVE' : 'UPLINK ✕ LOST',
    `${roster.agents.length} AGENTS ONLINE`,
    blocked ? `⚠ ${blocked} NEED${blocked > 1 ? '' : 'S'} YOU` : 'NO ONE BLOCKED',
    `${n('working')} WORKING`,
    clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
    FLAVOR[clock.getMinutes() % FLAVOR.length],
  ];
  const run = items.map((s, i) => (
    <span key={i} className={s.startsWith('⚠') || s.includes('LOST') ? 'hot' : undefined}>
      {s}
    </span>
  ));
  return (
    <div className="cy-ticker" aria-hidden="true">
      <div className="cy-ticker-track">
        {run}
        {run.map((el, i) => ({ ...el, key: `b${i}` }))}
      </div>
    </div>
  );
}

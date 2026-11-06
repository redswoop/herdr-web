// What a failed job's output MEANS, in one line for a human. Known shapes
// first (playwright, pytest, node), then the reason gaffer already had. Pure;
// the gaffer probe feeds it the log tail once per failure and caches.

const clean = (s) => String(s ?? '').replace(/\x1b\[[0-9;]*m/g, '');

export function meaningOf(logTail, reason = '') {
  const log = clean(logTail);
  const lines = log.split('\n');

  // playwright reporter: "  2 failed" / "  137 passed (2.0m)" + the failing titles
  const pwFail = log.match(/^\s*(\d+) failed\s*$/m);
  const pwPass = log.match(/^\s*(\d+) passed/m);
  if (pwFail) {
    const titles = [];
    let inFailed = false;
    for (const l of lines) {
      if (/^\s*\d+ failed\s*$/.test(l)) { inFailed = true; continue; }
      if (inFailed && /^\s*\d+ (passed|skipped|flaky)/.test(l)) break;
      const m = inFailed && l.match(/›\s*[^›]+?:\d+:\d+\s*›\s*(.+?)\s*›\s*(.+?)\s*─*\s*$/);
      if (m) titles.push(`${m[1].trim()} › ${m[2].trim()}`.replace(/\s+/g, ' '));
    }
    const n = Number(pwFail[1]);
    const names = titles.slice(0, 2).join('; ') + (titles.length > 2 ? ` +${titles.length - 2}` : '');
    return { kind: 'tests', text: `${n} test${n === 1 ? '' : 's'} failed${pwPass ? `, ${pwPass[1]} passed` : ''}${names ? `: ${names}` : ''}` };
  }

  // pytest summary line
  const py = log.match(/^=+ (.*?\bfailed\b.*?) =+\s*$/m) ?? log.match(/^=+ (.*?\berror\b.*?) =+\s*$/m);
  if (py) return { kind: 'tests', text: py[1].replace(/ in [\d.]+s.*$/, '') };

  // last "Error: …" / "FATAL …" / python traceback tail
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 80; i -= 1) {
    const l = lines[i].trim();
    const m = l.match(/^(?:\w*Error|FATAL|fatal|panic|Traceback \(most recent call last\))\b.*$/) ?? l.match(/^\w+(?:Error|Exception): .+$/);
    if (m && !/^Error Context:/.test(l)) return { kind: 'error', text: m[0].slice(0, 140) };
  }

  const r = clean(reason).replace(/^run exited \d+:\s*/, '').trim();
  return { kind: 'reason', text: (r || 'failed').slice(0, 140) };
}

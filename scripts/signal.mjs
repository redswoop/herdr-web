#!/usr/bin/env node
// Push a signal onto this box's herdr-web deck (POST /api/signals). The
// job-reporter door for loops gaffer doesn't run: a cleanup script, a copy,
// anything with a count. Zero deps; finds the daemon's token on its own.
//
//   node scripts/signal.mjs KEY [--title T] [--state ok|warn|alarm|busy|idle|needs-you|down]
//        [--detail D] [--done N --total M] [--pct P] [--value V --unit U] [--eta SECONDS]
//        [--href URL|PATH] [--cwd DIR] [--kind gauge|job|list|text] [--ttl SECONDS] [--delete]
//        [--url http://127.0.0.1:7683] [--token T]
//
//   node scripts/signal.mjs job:cleanup --title "Purging old renders" --done 3 --total 10 --state busy --cwd "$PWD"
//   node scripts/signal.mjs job:cleanup --delete
//
// KEY is source:thing. --cwd attaches the signal to the session running in
// that directory (the deck links back to it). Signals expire after --ttl
// (default 600 s) unless refreshed, so a dead loop never leaves a ghost.
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const args = process.argv.slice(2);
const key = args.find((a) => !a.startsWith('--'));
if (!key) {
  console.error('usage: signal.mjs KEY [--title T] [--state S] [--detail D] [--done N --total M] … (see header)');
  process.exit(2);
}
const opt = {};
for (let i = 0; i < args.length; i += 1) {
  if (!args[i].startsWith('--')) continue;
  const k = args[i].slice(2);
  const v = args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[++i] : true;
  opt[k] = v;
}
const num = (v) => (v === undefined || v === true ? undefined : Number(v));

let token = opt.token ?? process.env.HERDR_WEB_TOKEN;
if (!token) {
  try {
    const env = execFileSync('systemctl', ['--user', 'show', 'herdr-web', '-p', 'Environment', '--value'], { encoding: 'utf8' });
    token = (env.match(/HERDR_WEB_TOKEN=(\S+)/) ?? [])[1];
  } catch {}
}
const base = (opt.url ?? process.env.HERDR_WEB_URL ?? 'http://127.0.0.1:7683').replace(/\/$/, '');
const url = `${base}/api/signals${token ? `?token=${encodeURIComponent(token)}` : ''}`;
const body = opt.delete
  ? { key, delete: true }
  : {
      key,
      title: opt.title,
      kind: opt.kind,
      state: opt.state,
      detail: opt.detail,
      done: num(opt.done),
      total: num(opt.total),
      pct: num(opt.pct),
      value: num(opt.value),
      unit: opt.unit,
      eta: num(opt.eta),
      href: opt.href,
      host: opt.host ?? os.hostname().split('.')[0],
      ttl: num(opt.ttl),
      attach: opt.cwd ? { cwd: opt.cwd } : undefined,
    };
const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const j = await r.json().catch(() => ({}));
if (!r.ok) {
  console.error(`signal: ${r.status} ${j.error ?? ''}`);
  process.exit(1);
}
console.log(opt.delete ? `cleared ${key}` : `${key} → deck (expires in ${Math.round((j.expiresAt - Date.now()) / 1000)} s)`);

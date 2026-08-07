#!/usr/bin/env node
// Print a QR code that configures Capra in one camera scan:
//   capra://settings?server=<https url>&token=<token>
//
//   node scripts/capra-qr.mjs                  # prod: tailscale HTTPS on 443
//   node scripts/capra-qr.mjs --port 8443      # canary behind `tailscale serve --https=8443`
//   node scripts/capra-qr.mjs --server https://host:8443
//   node scripts/capra-qr.mjs --no-token       # server-only link (re-point an enrolled phone)
//
// Token comes from HERDR_WEB_TOKEN, else the systemd drop-in prod uses.
// The link (token included) is printed to the terminal — treat it like the
// token itself.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import qrcode from 'qrcode-terminal';

const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : null;
};

function tailscaleDns() {
  try {
    const s = JSON.parse(execFileSync('tailscale', ['status', '--json'], { encoding: 'utf8' }));
    const dns = s.Self?.DNSName?.replace(/\.$/, '');
    if (dns) return dns;
  } catch { /* tailscale absent or not up */ }
  return os.hostname();
}

function findToken() {
  if (process.env.HERDR_WEB_TOKEN) return process.env.HERDR_WEB_TOKEN;
  const conf = path.join(os.homedir(), '.config', 'systemd', 'user', 'herdr-web.service.d', 'token.conf');
  try {
    const m = /HERDR_WEB_TOKEN=(\S+)/.exec(fs.readFileSync(conf, 'utf8'));
    if (m) return m[1];
  } catch { /* no drop-in */ }
  return null;
}

let server = argOf('--server');
if (!server) {
  const port = argOf('--port');
  server = `https://${tailscaleDns()}${port ? `:${port}` : ''}`;
}

const params = new URLSearchParams({ server });
if (!args.includes('--no-token')) {
  const token = argOf('--token') ?? findToken();
  if (!token) {
    console.error('no token found (HERDR_WEB_TOKEN, token.conf) — pass --token or --no-token');
    process.exit(1);
  }
  params.set('token', token);
}

const link = `capra://settings?${params.toString()}`;
console.log(`\n  server: ${server}`);
console.log(`  link:   ${link}\n`);
qrcode.generate(link, { small: true });
console.log('\nPoint the iPhone camera at this. It offers "Open in Capra";');
console.log('the app adopts the server/token and reconnects on the spot.');

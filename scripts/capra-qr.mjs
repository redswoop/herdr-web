#!/usr/bin/env node
// Print a QR code that configures Capra in one camera scan:
//   capra://settings?server=<https url>&token=<token>
//
//   node scripts/capra-qr.mjs                  # prod: tailscale HTTPS on 443
//   node scripts/capra-qr.mjs --port 8443      # canary behind `tailscale serve --https=8443`
//   node scripts/capra-qr.mjs --server https://host:8443
//   node scripts/capra-qr.mjs --no-token       # server-only link (re-point an enrolled phone)
//   node scripts/capra-qr.mjs --name blackstar # chip label in the app (default: MagicDNS label)
//
// The link is ADDITIVE in Capra: a server it already knows gets its token /
// name updated, a new one is appended to the server list (multi-host).
//
// Token comes from HERDR_WEB_TOKEN, else the systemd drop-in (linux) or the
// launchd plist (mac) the service runs under.
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

const TAILSCALE = ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];
function tailscaleDns() {
  for (const bin of TAILSCALE) {
    try {
      const s = JSON.parse(execFileSync(bin, ['status', '--json'], { encoding: 'utf8' }));
      const dns = s.Self?.DNSName?.replace(/\.$/, '');
      if (dns) return dns;
    } catch { /* tailscale absent or not up */ }
  }
  return os.hostname();
}

function findToken() {
  if (process.env.HERDR_WEB_TOKEN) return process.env.HERDR_WEB_TOKEN;
  const confs = [
    path.join(os.homedir(), '.config', 'systemd', 'user', 'herdr-web.service.d', 'token.conf'),
    path.join(os.homedir(), 'Library', 'LaunchAgents', 'dev.redswoop.herdr-web.plist'),
  ];
  for (const conf of confs) {
    try {
      const text = fs.readFileSync(conf, 'utf8');
      const m = /HERDR_WEB_TOKEN=(\S+)/.exec(text)
        ?? /<key>HERDR_WEB_TOKEN<\/key>\s*<string>([^<]+)<\/string>/.exec(text);
      if (m) return m[1];
    } catch { /* not this platform */ }
  }
  return null;
}

let server = argOf('--server');
if (!server) {
  const port = argOf('--port');
  server = `https://${tailscaleDns()}${port ? `:${port}` : ''}`;
}

const params = new URLSearchParams({ server });
params.set('name', argOf('--name') ?? new URL(server).hostname.split('.')[0]);
if (!args.includes('--no-token')) {
  const token = argOf('--token') ?? findToken();
  if (!token) {
    console.error('no token found (HERDR_WEB_TOKEN, token.conf) — pass --token or --no-token');
    process.exit(1);
  }
  params.set('token', token);
}

const link = `capra://settings?${params.toString()}`;
const token = params.get('token');
console.log(`\n  server: ${server}`);
console.log(`  link:   ${link}`);
// the clickable form: an https URL terminals and chat apps turn into a link,
// served by the daemon as a page that bounces into the app
console.log(`  click:  ${server}/link${token ? `?token=${encodeURIComponent(token)}` : ''}\n`);
qrcode.generate(link, { small: true });
console.log('\nPoint the iPhone camera at this. It offers "Open in Capra";');
console.log('the app adds this host (or refreshes its token) and reconnects on the spot.');

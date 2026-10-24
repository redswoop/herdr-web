// Who is this server, and where is it reachable? Tailscale identity for
// multi-host clients (every peer is addressed by its MagicDNS name) and the
// capra:// enrolment link. Zero deps: shells out to the tailscale CLI when
// present — on macOS the App Store build keeps it inside the app bundle.
import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const CLI_CANDIDATES = [
  'tailscale',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/usr/bin/tailscale',
  '/opt/homebrew/bin/tailscale',
];

let cached; // {dns, ip} | null — identity doesn't move while we run

/** `{dns: 'myhost.tailnet-name.ts.net', ip: '100.x.y.z'}` or null without tailscale. */
export async function tailscaleInfo() {
  if (cached !== undefined) return cached;
  for (const bin of CLI_CANDIDATES) {
    try {
      const { stdout } = await execFileP(bin, ['status', '--json'], { timeout: 3000 });
      const self = JSON.parse(stdout).Self ?? {};
      const dns = (self.DNSName ?? '').replace(/\.$/, '');
      const ip = (self.TailscaleIPs ?? []).find((a) => a.includes('.')) ?? null;
      if (dns || ip) return (cached = { dns: dns || null, ip });
    } catch { /* next candidate */ }
  }
  return (cached = null);
}

/** The short name clients show on chips: MagicDNS label, else the OS hostname's first label. */
export async function shortHost() {
  const ts = await tailscaleInfo();
  const name = ts?.dns?.split('.')[0] || os.hostname().split('.')[0];
  return name.toLowerCase();
}

/** `--host auto` → the tailscale IP (tailnet-only, never the LAN), loopback if tailscale is down. */
export async function resolveBindHost(host) {
  if (host !== 'auto') return host;
  const ts = await tailscaleInfo();
  if (ts?.ip) return ts.ip;
  console.warn('[herdr-web] --host auto: tailscale not up, binding 127.0.0.1');
  return '127.0.0.1';
}

/** Where a phone reaches this server: `--public-url`, else https://<MagicDNS> (tailscale serve on 443). */
export async function publicUrl({ override, host, port }) {
  if (override) return override.replace(/\/$/, '');
  const ts = await tailscaleInfo();
  if (ts?.dns) return `https://${ts.dns}`;
  return `http://${host === '0.0.0.0' ? os.hostname() : host}:${port}`;
}

/** The one-tap enrolment link. Same `server` in the app updates in place; a new one is appended. */
export function capraLink({ server, token, name }) {
  const p = new URLSearchParams({ server });
  if (token) p.set('token', token);
  if (name) p.set('name', name);
  return `capra://settings?${p.toString()}`;
}

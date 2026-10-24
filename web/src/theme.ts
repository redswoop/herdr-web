import { useEffect, useState } from 'react';
import { GOOGLE_FONTS_URL, bootLog, setSkin, startCyberFx, stopCyberFx } from '@redswoop/cyberdos/web';
import { herdrBootLines, type Theme } from '@herdr/shared/cyber';

/** Optional skins layered over style.css tokens via <html data-theme>.
 *  'default' is the plain stylesheet; 'cyber' is @redswoop/cyberdos plus
 *  herdr's adapter (theme-cyber.css). */
export type { Theme };

const KEY = 'herdr.theme';
const EVENT = 'herdr-theme';
const THEME_COLOR: Record<Theme, string> = { default: '#0e0e13', cyber: '#0b0607' };

/** the herdr headings that decrypt on mount under the skin */
const SCRAMBLE = '.bar h1, .agent-name, .session .title, .ov-card-title, .modal-head h2, .group-title, .nc-where-name';

const asTheme = (v: string | null | undefined): Theme | null =>
  v === 'cyber' || v === 'default' ? v : null;

/** ?theme= link (which also saves) > cookie > legacy localStorage */
export function loadTheme(): Theme {
  const q = asTheme(new URLSearchParams(location.search).get('theme'));
  if (q) {
    saveTheme(q);
    return q;
  }
  const c = asTheme(document.cookie.match(/(?:^|;\s*)herdr\.theme=([^;]*)/)?.[1]);
  if (c) return c;
  try {
    const old = asTheme(localStorage.getItem(KEY));
    if (old) saveTheme(old); // promote to the cookie
    return old ?? 'default';
  } catch {
    return 'default';
  }
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'cyber' ? 'cyber' : 'default';
}

/** `flip` = a user toggle (plays the jack-in/out transition); at load the
 *  boot log plays once per tab instead */
export function applyTheme(t: Theme, { flip = false } = {}) {
  setSkin(t === 'cyber');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[t]);
  if (t === 'cyber') {
    if (!document.getElementById('cyber-fonts')) {
      const l = document.createElement('link');
      l.id = 'cyber-fonts';
      l.rel = 'stylesheet';
      l.href = GOOGLE_FONTS_URL;
      document.head.appendChild(l);
    }
    startCyberFx({ scramble: SCRAMBLE });
    if (flip) bootLog({ short: true });
    else if (!sessionFlag('herdr.booted')) bootLog({ lines: herdrBootLines(location.hostname) });
  } else {
    stopCyberFx();
    if (flip) crtOff();
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: t }));
}

/** a cookie, not localStorage: cookies ignore the port, so the dev server
 *  and the daemon (:5175 / :7683 on one host) share one choice */
export function saveTheme(t: Theme) {
  document.cookie = `${KEY}=${t}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function useTheme(): Theme {
  const [t, setT] = useState(currentTheme);
  useEffect(() => {
    const on = (e: Event) => setT((e as CustomEvent<Theme>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return t;
}

/** true if already set this tab; sets it either way */
function sessionFlag(k: string): boolean {
  try {
    if (sessionStorage.getItem(k)) return true;
    sessionStorage.setItem(k, '1');
  } catch {}
  return false;
}

function crtOff() {
  const el = document.createElement('div');
  el.className = 'theme-boot default';
  el.setAttribute('aria-hidden', 'true');
  el.textContent = 'jacking out';
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
  setTimeout(() => el.remove(), 1500); // reduced-motion kills animationend
}

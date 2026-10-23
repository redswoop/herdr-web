/* Enrolment links, parsed. Two spellings carry the same payload:
     capra://settings?server=https://…&token=…&name=…   (the QR, the deep link)
     https://host.ts.net/link?token=…                   (the clickable page)
   Pasting either into the add-host form fills it in. Pure, so it's testable. */

export interface CapraLink {
  server: string;
  token: string | null;
  name: string | null;
}

const clean = (v: string | null) => (v && v.trim() ? v.trim() : null);

export function parseCapraLink(text: string): CapraLink | null {
  const t = text.trim();
  if (!t) return null;
  // the deep link: expo-linking isn't needed, URL handles custom schemes once
  // the scheme is swapped for something the parser treats as hierarchical
  const m = /^capra:\/\/(?:settings)?\/?\??(.*)$/i.exec(t);
  if (m) {
    const q = new URLSearchParams(m[1]);
    const server = clean(q.get('server'));
    if (!server) return null;
    return { server: server.replace(/\/$/, ''), token: clean(q.get('token')), name: clean(q.get('name')) };
  }
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.pathname.replace(/\/$/, '') !== '/link') return null;
    const server = `${u.protocol}//${u.host}`;
    return { server, token: clean(u.searchParams.get('token')), name: clean(u.searchParams.get('name')) };
  } catch {
    return null;
  }
}

/** Does this look like a link at all (vs a plain server URL typed by hand)? */
export const looksLikeCapraLink = (text: string) => /^capra:\/\//i.test(text.trim()) || /\/link\?/.test(text);

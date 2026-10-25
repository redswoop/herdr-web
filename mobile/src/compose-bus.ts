/* Hand text to the composer from elsewhere in the screen (a bubble's
   "Quote in reply"). Same fire-and-forget shape as toast(). */
type Listener = (text: string) => void;
const listeners = new Set<Listener>();

export function quoteIntoComposer(text: string) {
  for (const l of listeners) l(text);
}

export function onComposerQuote(l: Listener): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** markdown blockquote of `text`, one `> ` per line */
export const asQuote = (text: string) =>
  text
    .trim()
    .split('\n')
    .map((l) => (l ? `> ${l}` : '>'))
    .join('\n');

/* Hand text to the composer from elsewhere in the screen (a bubble's
   "Quote in reply"). Same fire-and-forget shape as toast(). Agent screens
   stack (push), so every mounted composer hears the bus: the event names
   its pane and only that pane's composer takes it. */
type Listener = (text: string) => void;
const listeners = new Map<Listener, string>();

export function quoteIntoComposer(paneId: string, text: string) {
  for (const [l, p] of listeners) if (p === paneId) l(text);
}

export function onComposerQuote(paneId: string, l: Listener): () => void {
  listeners.set(l, paneId);
  return () => void listeners.delete(l);
}

/** markdown blockquote of `text`, one `> ` per line */
export const asQuote = (text: string) =>
  text
    .trim()
    .split('\n')
    .map((l) => (l ? `> ${l}` : '>'))
    .join('\n');

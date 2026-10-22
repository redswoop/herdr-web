/* Which screen a path opens in. Images are a modal sheet (the same native
   swipe-down-to-dismiss as settings); everything else is a card in the stack,
   so swipe-back retraces the folders you drilled through. */
export const IMG_RE = /\.(png|jpe?g|gif|webp|svg|avif|ico|bmp)$/i;

export const fileScreenFor = (path: string) =>
  IMG_RE.test(path) ? ('/agent/[paneId]/image' as const) : ('/agent/[paneId]/file' as const);

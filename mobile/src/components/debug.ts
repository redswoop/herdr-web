/** render-lab diagnostics (app/replay.tsx flips it): log measured heights to
 *  Metro so a blank/giant/overflowing cell can be identified without a
 *  screenshot. Lives in its own module so MdView and Transcript both reach it
 *  without a cycle. */
export const transcriptDebug = { log: false, noMvcp: false, noInverted: false };

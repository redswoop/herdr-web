# Grok TUI render problems (observed 2026-08-05/06)

Notes from a long Comfy/video debugging session where assistant replies
rendered badly in the Grok Build TUI.

## Symptoms

1. **While streaming**
   - Reply text first appears as **raw / broken-looking ASCII**
     (unrendered markdown: `###`, `| tables |`, `` ``` `` fences, `**bold**`)
   - Looks like the stream is painted before the markdown renderer runs

2. **On finalize**
   - The message bubble is **replaced**
   - Replacement often becomes a **giant broken box** (layout collapse /
     failed re-measure), not cleanly rendered markdown

3. User could see the content briefly “start” correctly (or as raw md), then
   lose it when the bubble swapped to the broken final state.

## Likely triggers (this session)

Heavy assistant formatting that tends to stress terminal markdown:

- Wide markdown **tables** (multi-column comparison grids)
- Nested / multiple **fenced code blocks**
- Dense **headers + bold + lists + tables** in one long bubble
- Long multi-section “recap” replies (e.g. the VHS Advanced Previews writeup)

Less likely the *content* (Comfy/VHS facts) and more the *shape* of the
markdown payload under streaming + final re-layout.

## Working hypothesis

Two-phase render in the TUI:

1. Stream path shows pre-render or partial-render text (raw md / glitchy ascii)
2. Final layout pass re-measures the bubble; tables/fences blow the width
   or height and the bubble degenerates into a broken box

If the same glitch happens on a **short plain reply** (no tables, minimal
fences), treat it as a pure TUI bug rather than markdown stress.

## Mitigations for the agent (until TUI is fixed)

- Prefer short paragraphs and **bullets over tables**
- Avoid wide comparison grids unless explicitly requested
- Keep code fences small and few per bubble
- Split long recaps into shorter messages when possible
- Don’t pack headers + tables + multi-fence dumps into one mega-bubble

## Repro notes (rough)

- Client: Grok Build TUI (session in `herdr-web` workspace, but issue is
  chat rendering, not the herdr app)
- Trigger example: long technical reply about Comfy history video embeds
  (VHS Advanced Previews → WebM/VP9 → iOS Safari can’t play)
- User requested a **repeat** of that reply; render still poor
- User then said “test”; short ack was fine — points at heavy md as the
  aggravating factor

## Related product context (not the render bug, but same session)

Comfy phone video issue that was being discussed when render broke:

- Direct `/view?…` MP4 links: OK on phone after h264 remux
- Download: OK
- **History tab embeds**: broken on iOS because ResultVideo uses VHS
  Advanced Previews → `/viewvideo` → live **WebM/VP9**, which Safari
  can’t play
- Mitigated by setting `VHS.AdvancedPreviews` = `Never` in
  `/mnt/data/ComfyData/user/default/comfy.settings.json`
- Also patched Comfy `/view` `Content-Disposition` to `inline; filename=…`
  (was bare `filename=` which Safari mishandles)

## Open questions for TUI

- Does finalization always full-replace the bubble DOM/cells, or only on
  markdown parse success?
- Table max width / wrap behavior in the bubble?
- Is streaming supposed to show raw md, or is that a regression?
- Any log/metrics when markdown parse or layout fails (the “broken box”)?

## Suggested fix direction (TUI)

- Stream with progressive markdown or plain text without a hard full-bubble
  replace that can wipe readable content
- On layout failure, fall back to plain text rather than an empty/broken box
- Soft-cap table width or auto-convert wide tables to lists in the TUI
- Preserve last good paint if re-render throws

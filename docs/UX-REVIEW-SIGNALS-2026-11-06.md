# UX review: the signals layer, 2026-11-06

Reviewed against one question: *does this feel useful to a human with seven to
nine working-memory registers*, not *does it look good*. Evidence: the live
dev build at 1440×900 this morning, every strip cell opened, the working chat,
the sidebar from inside a chat, and the store dump. Visuals are out of scope.

## The jobs a human brings to this page

Everything below is judged against these five. If an element serves none of
them it is cost.

| | Job | Where it should be answered |
|---|---|---|
| A | Does anything need me right now? | first glance at home, first glance in any chat |
| B | What is each project up to, and where did I leave off? | project cards |
| C | Can I start GPU work now, and what would it evict? | compute cell |
| D | Is the thing I started still going, how long left? | jobs cell, the launching chat |
| E | Something looks wrong. What, since when, and what do I do? | attention row |

## Register tax, ranked

Each item costs you something to decode on every visit. Ordered by how much.

### 1. The same fact in four places, verbs in one

Job 365 appears as a strip count, an attention row, a scene chip above the
chat, and a sidebar chip. Only the attention row can act on it. Three copies
are reminders without a handle, which is the definition of a nag. One row,
placed where it belongs (home: all; chat: the ones this chat launched),
replaces all four. Covered in the conversation already; the fix is the row.

### 2. Seven state words, seven glyphs, three vocabularies

Signals use `ok warn alarm busy idle needs-you down`. Gaffer uses `queued
running yielded held paused needs-you failed`. Herdr uses `working blocked
idle done`. The glyph set `✋ ⚠ ✕ △ ▶ ● ○` is seven symbols, which is your
whole budget spent on a legend. A human needs three: **needs you**, **broken**,
**working**. Everything else is plain text with no glyph and no colour. Warn
in particular has no action attached anywhere, so it is a colour that means
"feel slightly bad".

### 3. Numbers with opposite polarity in the same row

Disk cells show **free** (100G). GPU and host cells show **used** (25/32G,
15/16G). Inside the disk detail, the bar is used and the number is free. The
cpu cell is load, the mem cell is used. Each cell makes you recall which way
is good. Pick one polarity for the strip: *headroom*. Free disk, free VRAM,
idle cpu. Then "big number good" holds everywhere and the colour is spare.

### 4. Nothing says "normal"

`mospeada 15/16G` is dramatic and entirely expected (llama-server resident).
`svc 31 △ h3-motion` reads as a problem; it is a unit that has restarted five
times in 63 hours of uptime and is running fine. `5090 0% 25/32G` is the same.
The strip reports magnitudes and leaves you to supply the baseline. Each cell
needs a notion of *its own normal* so that at rest it renders dim and only
departure from normal gets ink. For the GPU that is "resident model holds
24G, 8G headroom, nothing rendering". For services it is "nothing changed".

### 5. Sparklines that autoscale lie

The hotbox-media sparkline shows a cliff. The change is 1.8 GB on 20 TB. Disk
history scaled to its own min/max turns noise into drama in exactly the place
you are trained to look for drama. Options: fixed scale (then it is flat and
pointless), or show a sparkline only when the rate is meaningful and let the
cell say the rate in words (`↓1.2G/m`). The cpu and gpu sparklines are 0–100
and honest; keep those.

### 6. The useful sentence is on hover

Hover titles carry *free of total*, *who holds the GPU*, *restart count*, the
unit lists. Hover is undiscoverable, invisible in a screenshot, absent on the
phone. If a fact earns a place it earns pixels or a click; if it does not, it
goes. Nothing should live only in `title=`.

### 7. Click-to-open adds size, not answers

Opening the compute cell shows the same three numbers bigger, a VRAM bar, a
holders list. The question behind the click (job C) is "can I render now and
what gets evicted?" The answer is one sentence: *8G free; a Comfy run would
evict qwen (24G, idle 40m)*. Disk detail: the question is "what is eating it,
how long until it matters?" Services detail: "what changed and what do I do?"
Every detail tile should open with the answer sentence, then the evidence.
Right now they open with evidence only.

### 8. Verbs without consequences or feedback

`ack` on a failed job: does it delete, hide, mark seen? Undo? `retry`: same
config, same host, and will anything tell me when it finishes? The buttons are
one word each and the row simply vanishes or changes. A verb needs a one-line
consequence on hover or in the confirm, and the retry should leave a visible
"re-running, ~2m" behind. `log` is rendered in the sub colour and reads as
disabled.

### 9. No "since you last looked"

The board is entirely present tense. Returning after two hours you cannot
tell which rows are new, which recaps changed, which job finished while you
were gone. For a surface glanced at periodically this is the single largest
missing affordance. A per-row *new since last visit* marker, cleared on view,
costs one bit of state per row and pays on every return.

### 10. Recaps address nobody in particular

NEXT lines mix "Human reloads page", "Deploy new build", "User decides…".
Sometimes the subject is you, sometimes the agent, sometimes unclear. Also the
two-line recap is clipped mid-sentence at card width, so the information you
paid a model call for is partially hidden. Fix the prompt: NOW is what
happened; NEXT is always *what you do*, imperative, ≤ 60 characters so it fits.

### 11. Repetition inside cards

Twenty-four rows each say `claude`. Every row says IDLE or DONE in the same
grey. The agent name is informative only when it differs from the card's
majority; the state word only when it is not the resting state. Remove both
at rest and the eye finds the one that is different.

### 12. Header pile-up in the chat

Tab strip, session title, status line, scene chip, then (when blocked) a
banner. Four to five rows of chrome before the first message. The scene chip
goes (item 1). The others are prior work but the budget is shared; worth a
look once the row exists.

### 13. No keyboard path

You are a keyboard person and this is a desktop surface. `j/k` across
attention rows, `Enter` to expand, `a`/`r`/`l` for the verbs, `1–5` for the
strip cells. Cheap, and it is the difference between a dashboard and a tool.

## Smaller things

- "up 63h" should be "2d 15h"; "since 08:08" is good.
- Strip cells shift position when a NAS disappears, breaking spatial memory. Reserve the slot and render it as "✕ hotbox" instead.
- `svc 31` counts units + containers + endpoints together. Either name what is counted or drop the count and show only the exceptions.
- The jobs cell title says "1 failed · 2 done today" and the attention row below says the same failure. Redundant.
- Sidebar footer `jack out · BLOCKED · 1 · 1e38004`: three unlabeled tokens.
- No calm state. When nothing needs you, home should read as calm in one line, with the strip present but dim.

## What is working and should be kept

- One strip row instead of five tiles. Position is stable, cost is ~30px.
- Attention rows with verbs inline. Right shape, wrong content (see the conversation: provenance, meaning, age, verb last).
- Workspace recaps instead of per-session beats. Right level.
- Probes → store → views. The seam makes all of the above cheap to change.
- Log tail in place, scrolled to the end.

## Recommended order

1. **The row.** One component: sentence addressed to you, provenance, meaning, age, verbs last, log behind a click, labeled navigation pills only. Home shows all; a chat shows its own; sidebar and scene chip and director go.
2. **Three states, one polarity.** Collapse the glyph set to needs-you / broken / working; everything else plain. Strip numbers are headroom.
3. **Normal and new.** Dim at rest; ink only for departure from normal; a *new since last visit* dot per row.
4. **Detail tiles open with the answer.** One sentence per tile that answers the job, then evidence. Move hover-only facts into the tile or delete them.
5. **Recap prompt.** NEXT is always what you do, ≤ 60 chars.
6. **Keyboard.** j/k/Enter/verbs.
7. Decay for stale failures; verb consequences; the small things.

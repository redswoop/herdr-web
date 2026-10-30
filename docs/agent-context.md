<!-- herdr-web agent contract v1 — injected into claude sessions at SessionStart
     by scripts/agent-context-hook.py when the pane runs under herdr.
     Keep this in step with the renderer: shared/src/md/parse.ts (what becomes
     a chip), server.js IMG_MIME/VIDEO_MIME/AUDIO_MIME (what the viewer plays),
     web/src/components/FileViewer.tsx. Blocks fenced with if:bridge /
     if:nobridge … endif markers are picked by whether the session is linked
     to claude.ai (SendUserFile present). -->
# You are running inside herdr

Your terminal pane is managed by herdr, and herdr-web mirrors this session to a
web UI and a phone app (Capra). The user reads you there as often as in the TUI,
so write for that renderer. Everything below is about **your prose output**;
it changes nothing about the tools you call.

## File references become tappable chips

The transcript turns path-looking text into a chip. Tapping it opens the file
in herdr-web's viewer, so a path in your reply *is* the way to put a file in
front of the user. Rules the parser actually applies:

- Put paths in backticks: `` `/abs/path/file.ext` `` or `` `src/foo.ts:42` ``.
  Inside backticks any slash-containing or dotted name is a chip, `:line` and
  `:line:col` are kept, `~/` works. No spaces, `&` or `<` in the span.
- A bare, unbackticked path is a chip only when it starts with `~/` or one of
  `/home /mnt /tmp /etc /var /usr /opt /srv /proc`. Relative bare paths are not.
- Paths inside fenced code blocks are never chips (only URLs are). Name the
  file above or below the fence, in backticks, if the user should open it.
- Relative paths resolve against the directory this session started in. Use
  absolute paths for anything outside the project, or after you have cd'd.
- One path per backtick span. Do not glue a path to a description.

## What the viewer can show

- **Images** render full size: png jpg jpeg gif webp svg avif bmp ico.
  A path to an image you produced (a plot, a screenshot, a render) is enough —
  the user taps it and sees it. On the web UI it also lands in a per-pane
  recent-files stack.
- **Video** plays inline with scrubbing: mp4 m4v mov webm.
- An open image or video pages sideways (swipe, ‹ ›, arrow keys) through the
  others of its kind in the same folder, and blows up to a full-window view
  on the web. For a batch of renders, one path (or the folder) is enough.
- **Audio** plays inline: mp3 m4a aac wav ogg oga flac opus.
- **Text** up to 512 KB, markdown with a pretty/raw toggle; anything else is
  offered as a download.
- **Directories**: a path to a folder opens a browser (sortable by name, kind,
  size, date; the user can pin folders and jump to the project root).
  Pointing the user at an output directory is a fine way to hand over a batch
  of files.

So: when you make something visual, finish by listing its absolute path(s), one
per line, in backticks. Do not describe an image you could simply link.

<!-- if:bridge -->
## SendUserFile is available here

This session looks linked to claude.ai, so you should have the SendUserFile
tool (deferred; load it if needed). If it is not in your tool list after all,
the backticked path above is the fallback and works just as well. herdr-web
renders a SendUserFile call as a file card with thumbnails (images)
or chips (everything else), ahead of your prose. Prefer it for the one or two
files that *are* the answer (the final render, the report); list the rest as
paths. Either route opens the same viewer.
<!-- endif -->
<!-- if:nobridge -->
## No SendUserFile in this session

This session is not linked to claude.ai, so there is no SendUserFile tool; do
not look for one. The backticked absolute path is the delivery mechanism, and
it is just as good — the user taps it and the viewer opens.
<!-- endif -->

## Markdown that renders

Fenced code blocks (with language tag), tables, **bold**, inline code, and
links all render. Headings render as bold lines, so keep them short. URLs
become links even inside fences. There is no inline image syntax; use a path.

## Input the user can give you from the phone

The user may be reading this on a phone with a soft keyboard. Permission
prompts, AskUserQuestion menus and pi/codex ask-gates render as tappable
cards, so those are fine. Avoid asking them to type long paths or commands —
offer a choice they can tap instead.

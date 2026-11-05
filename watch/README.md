# Capra for Apple Watch

Native SwiftUI (React Native doesn't run on watchOS). Roster → pane: the tail of
the transcript, the blocked card, and a bottom toolbar with quick replies, reply
(dictation or keyboard) and stop.

- **Polling, not streams.** watchOS only lets audio/call apps hold long-lived
  sockets, so the roster polls every 3 s and a pane every 2 s (working/blocked)
  or 5 s (idle), using `transcript?tail=60&lite=1` (about 15 KB instead of about 180 KB).
- **Answer bodies match web/src/components/BlockedCard.tsx.**
- **Server + token** live in UserDefaults (`server`, `token`). Linking from the
  phone isn't built yet; set them by hand for now.

## Simulator loop (from stormer)

The Mac (blackstar) has Xcode 26.5, XcodeGen (brew), and a watchOS 26.5 runtime with
the "Capra Watch S8" simulator `<udid>`.

```sh
# once per simulator
ssh blackstar 'xcrun simctl spawn <udid> defaults write dev.redswoop.capra.watchkitapp server https://<host>.ts.net'
ssh blackstar "xcrun simctl spawn <udid> defaults write dev.redswoop.capra.watchkitapp token '<token>'"

watch/sim.sh /tmp/w.png                      # rsync, xcodegen, build, install, launch, screenshot
watch/sim.sh /tmp/w.png -open 'w3K:pA'       # land on a pane
watch/sim.sh /tmp/w.png -open 'w3K:pA' -anchor top   # head of the transcript (no crown over ssh)
watch/sim.sh /tmp/w.png -open fixture:plan   # DEBUG blocked-card fixtures: permission|ask|menu|plan|unknown
watch/sim.sh /tmp/w.png -open 'w3K:pA' -send 'hi'    # DEBUG: fire one prompt
```

Launch args are volatile (NSArgumentDomain), so they never stick.

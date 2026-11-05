#if DEBUG
import SwiftUI

/// Dev-only: `simctl launch … -open fixture:<kind>` renders a BlockedCard
/// from canned JSON, so every answer shape can be eyeballed without a real
/// agent stuck on a real prompt. Taps print the body instead of posting it.
struct FixtureView: View {
  let kind: String
  @State private var last = ""

  static let samples: [String: String] = [
    "permission": #"{"kind":"permission","tool":"Bash","detail":"rm -rf build && npm run build:web","options":[{"n":1,"label":"Yes","description":"","selected":true},{"n":2,"label":"Yes, and don't ask again for npm run build:web","description":"","selected":false},{"n":3,"label":"No, and tell Claude what to do differently","description":"","selected":false}]}"#,
    "ask": #"{"kind":"ask","questions":[{"question":"Which port should the watch dev server use?","options":[{"label":"7683","description":"the live one"},{"label":"7693","description":"rail instance"}]}]}"#,
    "menu": #"{"kind":"menu","header":"Trust folder","question":"Do you trust the files in this folder?","detail":"/home/user/project","options":[{"n":1,"label":"Yes, proceed","description":"","selected":true},{"n":2,"label":"No, exit","description":"","selected":false}],"nav":true}"#,
    "plan": ###"{"kind":"plan","plan":"## Plan\n\n1. Add `?lite=1` to transcript\n2. Poll every 2s while working\n\n```swift\nlet x = 1\n```","question":"Would you like to proceed?","options":[{"n":1,"label":"Yes, and auto-accept edits","description":"","selected":true},{"n":2,"label":"Yes, manually approve edits","description":"","selected":false},{"n":3,"label":"No, keep planning","description":"","selected":false},{"n":4,"label":"Tell Claude what to change","description":"","selected":false,"input":true}]}"###,
    "unknown": #"{"kind":"unknown"}"#,
  ]

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 8) {
        if let json = Self.samples[kind], let ctx = try? JSONDecoder().decode(BlockedCtx.self, from: Data(json.utf8)) {
          BlockedCard(ctx: ctx, screen: "╭───╮\n│ Do you want to proceed? │\n│ ❯ 1. Yes │\n│   2. No │\n╰───╯", busy: false) { body in
            let data = (try? JSONEncoder().encode(body)) ?? Data()
            last = String(decoding: data, as: UTF8.self)
            print("[fixture] answer", last)
          }
        } else {
          Text("no fixture \(kind)")
        }
        if !last.isEmpty { Text(last).font(.system(size: 10, design: .monospaced)).foregroundStyle(Theme.sub) }
      }
    }
    .navigationTitle(kind)
  }
}
#endif

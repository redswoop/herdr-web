import SwiftUI

@main
struct CapraWatchApp: App {
  @State private var roster = RosterModel()
  // dev: `simctl launch … -open w3K:pA` lands straight on a pane
  @State private var path: [String] = UserDefaults.standard.string(forKey: "open").map { [$0] } ?? []

  var body: some Scene {
    WindowGroup {
      NavigationStack(path: $path) {
        RosterView()
      }
      .environment(roster)
      .task { await roster.poll() }
      .tint(Theme.live)
      .foregroundStyle(Theme.text)
    }
  }
}

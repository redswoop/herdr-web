import SwiftUI

struct RosterView: View {
  @Environment(RosterModel.self) private var roster
  @State private var showAll = false

  /** idle for a day with nothing pending: folded behind "older" */
  private func isStale(_ a: Agent) -> Bool {
    guard a.status != .blocked, a.status != .working, let t = a.lastActiveAt else { return false }
    return Date().timeIntervalSince1970 * 1000 - t > 24 * 3600_000
  }

  var body: some View {
    let fresh = roster.agents.filter { !isStale($0) }
    let stale = roster.agents.filter(isStale)
    List {
      if !Config.isSet {
        Text("No server linked yet.\nOpen Capra on your phone to link this watch.")
          .font(.footnote)
          .foregroundStyle(Theme.sub)
      }
      if roster.herdrDown {
        Label("herdr is down", systemImage: "bolt.horizontal.circle").foregroundStyle(Theme.alarm)
      }
      if let e = roster.error {
        Label(e, systemImage: "wifi.exclamationmark").font(.footnote).foregroundStyle(Theme.chrome)
      }
      ForEach(fresh) { a in row(a) }
      if !stale.isEmpty {
        if showAll {
          ForEach(stale) { a in row(a) }
        } else {
          Button("older · \(stale.count)") { showAll = true }
            .font(.footnote)
            .foregroundStyle(Theme.sub)
        }
      }
      if roster.loaded && roster.agents.isEmpty {
        Text("no agents").foregroundStyle(Theme.sub)
      }
    }
    .navigationTitle(roster.host ?? "herdr")
    .navigationDestination(for: String.self) { id in
      #if DEBUG
      if id.hasPrefix("fixture:") {
        FixtureView(kind: String(id.dropFirst("fixture:".count)))
      } else {
        PaneView(paneId: id)
      }
      #else
      PaneView(paneId: id)
      #endif
    }
    .overlay {
      if !roster.loaded && Config.isSet && roster.error == nil { ProgressView() }
    }
  }

  private func row(_ a: Agent) -> some View {
    NavigationLink(value: a.paneId) {
      HStack(alignment: .top, spacing: 7) {
        StatusDot(status: a.status).padding(.top, 5)
        VStack(alignment: .leading, spacing: 2) {
          Text(a.name)
            .font(.system(size: 15, weight: a.status == .blocked ? .semibold : .regular))
            .lineLimit(2)
          Text([a.folder, a.agent == "claude" ? nil : a.agent, ago(a.lastActiveAt)].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
            .font(.system(size: 12))
            .foregroundStyle(Theme.sub)
            .lineLimit(1)
        }
      }
    }
    .listRowBackground(
      RoundedRectangle(cornerRadius: 10)
        .fill(a.status == .blocked ? Theme.alarm.opacity(0.16) : Color.white.opacity(0.07)))
  }
}

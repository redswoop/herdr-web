import SwiftUI

/// One agent: the tail of its transcript, then whatever it's blocked on, in
/// one crown-scrolled column pinned to the bottom. Input lives in the bottom
/// toolbar: quick replies, reply (dictation/keyboard), stop.
struct PaneView: View {
  let paneId: String
  @Environment(RosterModel.self) private var roster
  @State private var model: PaneModel
  @State private var quick = false

  static let quickReplies = ["yes", "go ahead", "continue", "commit it", "no", "/clear"]
  // dev: `-anchor top` to screenshot the head of a transcript (no crown over ssh)
  private static let anchor: UnitPoint = UserDefaults.standard.string(forKey: "anchor") == "top" ? .top : .bottom

  init(paneId: String) {
    self.paneId = paneId
    _model = State(initialValue: PaneModel(paneId: paneId))
  }

  private var agent: Agent? { roster.agent(paneId) }
  private var status: AgentStatus { agent?.status ?? .unknown }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 8) {
        if !model.loaded && model.error == nil {
          ProgressView().frame(maxWidth: .infinity)
        }
        ForEach(model.rows) { RowView(row: $0) }
        if status == .working {
          HStack(spacing: 5) {
            ProgressView().controlSize(.mini).frame(width: 14, height: 14)
            Text("working…").font(.system(size: 12)).foregroundStyle(Theme.active)
          }
        }
        if let ctx = model.blocked, status == .blocked {
          BlockedCard(ctx: ctx, screen: model.screen, busy: model.busy) { body in
            Task {
              await model.answer(body)
              await roster.refresh()
            }
          }
        }
        if let e = model.error {
          Text(e).font(.system(size: 12)).foregroundStyle(Theme.chrome)
        }
      }
      .padding(.horizontal, 2)
      .padding(.bottom, 6)
    }
    .defaultScrollAnchor(Self.anchor)
    .navigationTitle {
      HStack(spacing: 4) {
        StatusDot(status: status, size: 6)
        Text(agent?.name ?? paneId).lineLimit(1)
      }
    }
    .toolbar {
      ToolbarItemGroup(placement: .bottomBar) {
        Button {
          quick = true
        } label: {
          Image(systemName: "text.bubble")
        }
        TextFieldLink(prompt: Text("Reply")) {
          Image(systemName: "mic.fill").foregroundStyle(Theme.bg)
        } onSubmit: { text in
          Task { await model.send(text) }
        }
        if status == .working {
          Button {
            Task { await model.stop() }
          } label: {
            Image(systemName: "stop.fill")
          }
          .tint(Theme.chrome)
        }
      }
    }
    .disabled(model.busy)
    .sheet(isPresented: $quick) {
      List(Self.quickReplies, id: \.self) { q in
        Button(q) {
          quick = false
          Task { await model.send(q) }
        }
        .foregroundStyle(Theme.live)
      }
    }
    .task(id: paneId) {
      #if DEBUG
      // dev: `-send "text"` exercises the prompt path without a crown or a mic
      if let t = UserDefaults.standard.string(forKey: "send") { await model.send(t) }
      #endif
      while !Task.isCancelled {
        await model.refresh()
        await model.refreshBlocked(roster.agent(paneId)?.status)
        let s = roster.agent(paneId)?.status
        try? await Task.sleep(for: .seconds(s == .working || s == .blocked ? 2 : 5))
      }
    }
  }
}

struct Chip: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 13))
      .padding(.horizontal, 10)
      .padding(.vertical, 6)
      .background(Theme.live.opacity(configuration.isPressed ? 0.45 : 0.2), in: Capsule())
      .foregroundStyle(Theme.live)
  }
}

struct RowView: View {
  let row: Row

  var body: some View {
    switch row {
    case .user(_, let text, let pending):
      Text(text.count > 500 ? String(text.prefix(500)) + "…" : text)
        .font(.system(size: 14))
        .padding(7)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.chrome.opacity(0.18), in: RoundedRectangle(cornerRadius: 9))
        .overlay(alignment: .bottomTrailing) {
          if pending { Image(systemName: "clock").font(.system(size: 9)).foregroundStyle(Theme.sub).padding(4) }
        }
        .opacity(pending ? 0.6 : 1)
    case .assistant(_, let text):
      MdView(text)
    case .tools(_, let lines, let thinking):
      ToolsRow(lines: lines, thinking: thinking)
    case .command(_, let text):
      Text(text).font(.system(size: 12, design: .monospaced)).foregroundStyle(Theme.live)
    case .note(_, let text):
      Text(text).font(.system(size: 11)).foregroundStyle(Theme.sub)
    }
  }
}

/// "⚙ Bash ×3 · Read" — the last call visible, the rest a tap away.
struct ToolsRow: View {
  let lines: [String]
  let thinking: Bool
  @State private var open = false

  private var summary: String {
    var counts: [(String, Int)] = []
    for l in lines {
      let name = String(l.split(separator: " ").first ?? "")
      if let i = counts.firstIndex(where: { $0.0 == name }) { counts[i].1 += 1 } else { counts.append((name, 1)) }
    }
    var parts = counts.map { $0.1 > 1 ? "\($0.0) ×\($0.1)" : $0.0 }
    if thinking { parts.insert("thought", at: 0) }
    return parts.joined(separator: " · ")
  }

  var body: some View {
    Button {
      open.toggle()
    } label: {
      VStack(alignment: .leading, spacing: 2) {
        Text("⚙ " + summary).font(.system(size: 11, weight: .medium))
        ForEach(Array((open ? lines : Array(lines.suffix(1))).enumerated()), id: \.offset) { _, l in
          Text(l).font(.system(size: 10, design: .monospaced)).lineLimit(open ? 3 : 1)
        }
      }
      .foregroundStyle(Theme.sub)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .buttonStyle(.plain)
  }
}

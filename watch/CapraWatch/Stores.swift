import SwiftUI
import WatchKit

/// The roster, polled while the app is on screen (watchOS suspends us on
/// wrist-down, which pauses the loop for free).
@MainActor @Observable final class RosterModel {
  var agents: [Agent] = []
  var loaded = false
  var error: String?
  var herdrDown = false
  var host: String?

  func agent(_ paneId: String) -> Agent? { agents.first { $0.paneId == paneId } }

  func refresh() async {
    do {
      let r = try await API.roster()
      let sorted = r.agents.sorted {
        ($0.status.rank, -($0.lastActiveAt ?? 0), $0.name) < ($1.status.rank, -($1.lastActiveAt ?? 0), $1.name)
      }
      // a pane that just went blocked taps the wrist
      let wasBlocked = Set(agents.filter { $0.status == .blocked }.map(\.paneId))
      if loaded, sorted.contains(where: { $0.status == .blocked && !wasBlocked.contains($0.paneId) }) {
        WKInterfaceDevice.current().play(.notification)
      }
      if sorted != agents { agents = sorted }
      herdrDown = r.herdrDown ?? false
      host = r.host
      error = nil
      loaded = true
    } catch {
      self.error = error.localizedDescription
    }
  }

  func poll() async {
    while !Task.isCancelled {
      await refresh()
      try? await Task.sleep(for: .seconds(3))
    }
  }
}

/// One transcript line on the watch. Tool calls, results and thinking fold
/// into a single grey "tools" row per run.
enum Row: Identifiable, Equatable {
  case user(id: String, text: String, pending: Bool)
  case assistant(id: String, text: String)
  case tools(id: String, lines: [String], thinking: Bool)
  case command(id: String, text: String)
  case note(id: String, text: String)

  var id: String {
    switch self {
    case .user(let id, _, _), .assistant(let id, _), .tools(let id, _, _), .command(let id, _), .note(let id, _): id
    }
  }

  static func build(_ events: [TEvent]) -> [Row] {
    var rows: [Row] = []
    var tools: [String] = []
    var thinking = false
    var toolsId = ""

    func flush() {
      if !tools.isEmpty || thinking { rows.append(.tools(id: toolsId, lines: tools, thinking: thinking)) }
      tools = []
      thinking = false
    }

    for (i, e) in events.enumerated() {
      let id = "\(e.ts ?? "")#\(i)"
      switch e.kind {
      case "user":
        flush()
        rows.append(.user(id: id, text: e.text, pending: false))
      case "assistant":
        flush()
        if !e.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { rows.append(.assistant(id: id, text: e.text)) }
      case "tool_use":
        if tools.isEmpty && !thinking { toolsId = id }
        tools.append(toolLine(e))
      case "thought":
        if tools.isEmpty && !thinking { toolsId = id }
        thinking = true
      case "command":
        flush()
        rows.append(.command(id: id, text: [e.name ?? "", e.text].filter { !$0.isEmpty }.joined(separator: " ")))
      case "note":
        flush()
        rows.append(.note(id: id, text: e.text))
      default:
        break // tool_result, usage, command_out: not wrist material
      }
    }
    flush()
    return rows
  }

  private static func toolLine(_ e: TEvent) -> String {
    let name = e.name ?? "tool"
    let i = e.input
    var arg = i?["command"] ?? i?["description"] ?? i?["pattern"] ?? i?["url"] ?? i?["query"] ?? i?["prompt"] ?? ""
    if let p = i?["file_path"] ?? i?["path"] { arg = (p as NSString).lastPathComponent }
    let first = arg.split(separator: "\n").first.map(String.init) ?? ""
    return first.isEmpty ? name : "\(name) \(first.prefix(80))"
  }
}

@MainActor @Observable final class PaneModel {
  let paneId: String
  var rows: [Row] = []
  var loaded = false
  var error: String?
  var blocked: BlockedCtx?
  var screen: String?
  var pending: String?
  var busy = false
  private var offset: Int?
  private var events: [TEvent] = []

  init(paneId: String) { self.paneId = paneId }

  func refresh() async {
    do {
      let page = try await API.transcript(paneId, tail: 60)
      error = nil
      guard !loaded || page.offset != offset else { return }
      offset = page.offset
      events = page.events
      if let p = pending, events.contains(where: { $0.kind == "user" && $0.text.trimmingCharacters(in: .whitespacesAndNewlines) == p }) {
        pending = nil
      }
      rebuild()
      loaded = true
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func rebuild() {
    var r = Row.build(events)
    if let p = pending { r.append(.user(id: "pending", text: p, pending: true)) }
    if r != rows { rows = r }
  }

  func refreshBlocked(_ status: AgentStatus?) async {
    guard status == .blocked else {
      blocked = nil
      screen = nil
      return
    }
    let ctx = (try? await API.blockedContext(paneId)) ?? .unknown
    if ctx != blocked { blocked = ctx }
    if ctx == .unknown {
      let s = try? await API.screen(paneId)
      if s != screen { screen = s }
    }
  }

  @discardableResult
  func send(_ text: String) async -> Bool {
    let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !t.isEmpty else { return false }
    busy = true
    defer { busy = false }
    do {
      try await API.prompt(paneId, t)
      pending = t
      rebuild()
      WKInterfaceDevice.current().play(.success)
      return true
    } catch {
      self.error = error.localizedDescription
      WKInterfaceDevice.current().play(.failure)
      return false
    }
  }

  func answer(_ body: AnswerBody) async {
    busy = true
    defer { busy = false }
    do {
      try await API.answer(paneId, body)
      blocked = nil
      WKInterfaceDevice.current().play(.success)
    } catch let e as APIError where e.status == 409 {
      // the screen moved under us — show what it is now
      error = "screen changed"
      blocked = .unknown
      screen = try? await API.screen(paneId)
      WKInterfaceDevice.current().play(.failure)
    } catch {
      self.error = error.localizedDescription
      WKInterfaceDevice.current().play(.failure)
    }
  }

  func stop() async {
    busy = true
    defer { busy = false }
    do {
      try await API.interrupt(paneId)
      WKInterfaceDevice.current().play(.stop)
    } catch {
      self.error = error.localizedDescription
    }
  }
}

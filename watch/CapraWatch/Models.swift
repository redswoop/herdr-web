import Foundation

// Mirrors of shared/src/types.ts — only the fields the watch reads.

enum AgentStatus: String, Decodable, Sendable {
  case blocked, working, idle, done, unknown

  init(from decoder: Decoder) throws {
    let raw = try decoder.singleValueContainer().decode(String.self)
    self = AgentStatus(rawValue: raw) ?? .unknown
  }

  /** attention order: blocked, then working, then the rest */
  var rank: Int {
    switch self {
    case .blocked: 0
    case .working: 1
    default: 2
    }
  }
}

struct Agent: Decodable, Identifiable, Sendable, Equatable {
  let paneId: String
  let agent: String
  let label: String?
  let title: String
  let status: AgentStatus
  let cwd: String?
  let launchPending: Bool?
  let sessionTitle: String?
  let firstPrompt: String?
  let lastActiveAt: Double?

  var id: String { paneId }

  var folder: String? {
    guard let cwd else { return nil }
    return (cwd as NSString).lastPathComponent
  }

  /** shared/src/roster-groups.ts chipName(): a human's label, else the live
   *  title, else the session's own title, else the first prompt */
  var name: String {
    if let label, !label.isEmpty, !isAutoLabel { return label }
    if !title.isEmpty, !isGenericTitle(title) { return title }
    if let t = sessionTitle?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty { return t }
    if let p = firstPrompt?.trimmingCharacters(in: .whitespacesAndNewlines), !p.isEmpty {
      return String(p.split(separator: "\n").first ?? "")
    }
    return label ?? (title.isEmpty ? paneId : title)
  }

  private var isAutoLabel: Bool {
    let slug = paneId.filter { $0.isLetter || $0.isNumber }.lowercased()
    return label == "\(agent)-\(slug)"
  }

  private func isGenericTitle(_ t: String) -> Bool {
    var s = t.trimmingCharacters(in: .whitespaces)
    if s.isEmpty || s.hasPrefix("~") || s.hasPrefix("/") { return true }
    let noise = [agent, "Claude Code", folder, "π"].compactMap { $0 }.sorted { $0.count > $1.count }
    for n in noise { s = s.replacingOccurrences(of: n, with: " ", options: .caseInsensitive) }
    return s.filter(\.isLetter).count < 3
  }
}

struct Roster: Decodable, Sendable {
  let agents: [Agent]
  let herdrDown: Bool?
  let host: String?
}

/** loose JSON, for tool inputs */
enum JSONValue: Decodable, Sendable, Equatable {
  case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null

  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() { self = .null }
    else if let v = try? c.decode(String.self) { self = .string(v) }
    else if let v = try? c.decode(Bool.self) { self = .bool(v) }
    else if let v = try? c.decode(Double.self) { self = .number(v) }
    else if let v = try? c.decode([String: JSONValue].self) { self = .object(v) }
    else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
    else { self = .null }
  }

  subscript(key: String) -> String? {
    if case .object(let o) = self, case .string(let s)? = o[key] { return s }
    return nil
  }
}

struct TEvent: Decodable, Sendable, Equatable {
  let kind: String
  let text: String
  let name: String?
  let ts: String?
  let input: JSONValue?
}

struct TranscriptPage: Decodable, Sendable {
  let events: [TEvent]
  let offset: Int?
  let total: Int?
}

struct MenuOption: Decodable, Sendable, Equatable, Identifiable {
  let n: Int
  let label: String
  let description: String?
  let selected: Bool?
  let input: Bool?
  var id: Int { n }
}

struct AskQuestion: Decodable, Sendable, Equatable {
  struct Opt: Decodable, Sendable, Equatable {
    let label: String
    let description: String?
  }
  let question: String
  let multiSelect: Bool?
  let options: [Opt]
}

/** GET /api/agent/:id/blocked-context, decoded on `kind` */
enum BlockedCtx: Decodable, Sendable, Equatable {
  case none
  case unknown
  case ask(questions: [AskQuestion])
  case permission(tool: String, detail: String, options: [MenuOption]?)
  case menu(question: String, detail: String, options: [MenuOption], byNav: Bool)
  case plan(plan: String, question: String?, options: [MenuOption]?)

  private enum K: String, CodingKey {
    case kind, questions, tool, detail, options, header, question, nav, plan
  }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: K.self)
    switch try c.decode(String.self, forKey: .kind) {
    case "none": self = .none
    case "ask": self = .ask(questions: try c.decode([AskQuestion].self, forKey: .questions))
    case "permission":
      self = .permission(
        tool: try c.decode(String.self, forKey: .tool),
        detail: (try? c.decode(String.self, forKey: .detail)) ?? "",
        options: try? c.decode([MenuOption].self, forKey: .options))
    case "menu":
      let options = try c.decode([MenuOption].self, forKey: .options)
      let q = (try? c.decode(String.self, forKey: .question)) ?? ""
      let h = (try? c.decode(String.self, forKey: .header)) ?? ""
      let nav = (try? c.decode(Bool.self, forKey: .nav)) ?? false
      self = .menu(
        question: q.isEmpty ? h : q,
        detail: (try? c.decode(String.self, forKey: .detail)) ?? "",
        options: options,
        // a free-text row swallows digits, an unnumbered menu has none
        byNav: nav || options.contains { $0.input == true })
    case "plan":
      self = .plan(
        plan: (try? c.decode(String.self, forKey: .plan)) ?? "",
        question: try? c.decode(String.self, forKey: .question),
        options: try? c.decode([MenuOption].self, forKey: .options))
    default: self = .unknown
    }
  }
}

/** POST /api/agent/:id/answer */
struct AnswerBody: Encodable, Sendable {
  var keys: [String]? = nil
  var expect: String? = nil
  var option: Int? = nil
  var feedback: String? = nil
}

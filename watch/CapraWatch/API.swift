import Foundation

/// Server URL + token. Dev: `simctl spawn <udid> defaults write
/// dev.redswoop.capra.watchkitapp server https://…` (and `token`), or launch
/// args `-server … -token …`. The phone hands these over later.
enum Config {
  static var server: String {
    (UserDefaults.standard.string(forKey: "server") ?? "").trimmingCharacters(in: .whitespaces)
      .replacingOccurrences(of: "/$", with: "", options: .regularExpression)
  }
  static var token: String? { UserDefaults.standard.string(forKey: "token") }
  static var isSet: Bool { !server.isEmpty }
}

struct APIError: LocalizedError {
  let status: Int
  let message: String
  var errorDescription: String? { status > 0 ? "\(status) \(message)" : message }
}

/// Plain request/response only: watchOS keeps long-lived sockets (and so the
/// SSE streams) to audio/call apps, so every live view here polls.
enum API {
  private static let session: URLSession = {
    let c = URLSessionConfiguration.default
    c.timeoutIntervalForRequest = 12
    c.waitsForConnectivity = false
    return URLSession(configuration: c)
  }()

  private static func url(_ path: String, _ query: [URLQueryItem] = []) throws -> URL {
    guard Config.isSet, var comps = URLComponents(string: Config.server + path) else {
      throw APIError(status: 0, message: "no server set")
    }
    var q = query
    if let t = Config.token, !t.isEmpty { q.append(URLQueryItem(name: "token", value: t)) }
    if !q.isEmpty { comps.queryItems = q }
    guard let u = comps.url else { throw APIError(status: 0, message: "bad server url") }
    return u
  }

  private static func agentPath(_ paneId: String, _ action: String) -> String {
    let id = paneId.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? paneId
    return "/api/agent/\(id)/\(action)"
  }

  private static func send<T: Decodable>(_ req: URLRequest, as: T.Type) async throws -> T {
    let (data, resp) = try await session.data(for: req)
    let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      let msg = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
      throw APIError(status: status, message: msg ?? HTTPURLResponse.localizedString(forStatusCode: status))
    }
    return try JSONDecoder().decode(T.self, from: data)
  }

  private static func get<T: Decodable>(_ path: String, _ query: [URLQueryItem] = [], as t: T.Type) async throws -> T {
    try await send(URLRequest(url: url(path, query)), as: t)
  }

  private struct OK: Decodable {}

  private static func post(_ path: String, _ body: some Encodable) async throws {
    var req = URLRequest(url: try url(path))
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "content-type")
    req.httpBody = try JSONEncoder().encode(body)
    _ = try await send(req, as: OK.self)
  }

  static func roster() async throws -> Roster {
    try await get("/api/roster", as: Roster.self)
  }

  static func transcript(_ paneId: String, tail: Int) async throws -> TranscriptPage {
    try await get(agentPath(paneId, "transcript"), [URLQueryItem(name: "tail", value: String(tail)), URLQueryItem(name: "lite", value: "1")], as: TranscriptPage.self)
  }

  static func blockedContext(_ paneId: String) async throws -> BlockedCtx {
    try await get(agentPath(paneId, "blocked-context"), as: BlockedCtx.self)
  }

  struct Screen: Decodable { let text: String }
  static func screen(_ paneId: String) async throws -> String {
    try await get(agentPath(paneId, "screen"), as: Screen.self).text
  }

  static func prompt(_ paneId: String, _ text: String) async throws {
    try await post(agentPath(paneId, "prompt"), ["text": text])
  }

  static func interrupt(_ paneId: String) async throws {
    try await post(agentPath(paneId, "interrupt"), [String: String]())
  }

  static func answer(_ paneId: String, _ body: AnswerBody) async throws {
    try await post(agentPath(paneId, "answer"), body)
  }
}

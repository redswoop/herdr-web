import SwiftUI

/// CyberDOS palette 0 (red chrome, teal live, yellow signal) — the cyber skin
/// the web and Capra default to. Roles, not hues: see shared/src/cyber.ts.
enum Theme {
  static let chrome = Color(hex: 0xff6a5c)
  static let live = Color(hex: 0x5fe3d4)
  static let alarm = Color(hex: 0xfcee0a)
  static let active = Color(hex: 0x5ef6ff)
  static let ok = Color(hex: 0x4b9e96)
  static let muted = Color(hex: 0x54413f)
  static let text = Color(hex: 0xf1e3d2)
  static let sub = Color(hex: 0x9b867b)
  static let bg = Color(hex: 0x0b0607)

  static func color(_ s: AgentStatus) -> Color {
    switch s {
    case .blocked: alarm
    case .working: active
    case .done: ok
    default: muted
    }
  }
}

extension Color {
  init(hex: UInt32) {
    self.init(
      red: Double((hex >> 16) & 0xff) / 255,
      green: Double((hex >> 8) & 0xff) / 255,
      blue: Double(hex & 0xff) / 255)
  }
}

struct StatusDot: View {
  let status: AgentStatus
  var size: CGFloat = 8

  var body: some View {
    let c = Theme.color(status)
    Circle()
      .fill(c)
      .frame(width: size, height: size)
      .shadow(color: status == .idle || status == .unknown ? .clear : c.opacity(0.9), radius: 4)
  }
}

func ago(_ ms: Double?) -> String {
  guard let ms else { return "" }
  let s = max(0, Date().timeIntervalSince1970 - ms / 1000)
  if s < 60 { return "now" }
  if s < 3600 { return "\(Int(s / 60))m" }
  if s < 86400 { return "\(Int(s / 3600))h" }
  return "\(Int(s / 86400))d"
}

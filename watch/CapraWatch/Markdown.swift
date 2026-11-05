import SwiftUI

/// Just enough markdown for a wrist: paragraphs/headings/bullets render,
/// fenced code and tables fold to a tappable chip — nobody reads a diff here.
enum MdBlock: Hashable {
  case para(String)
  case heading(String)
  case bullet(marker: String, text: String, depth: Int)
  case quote(String)
  case code(lang: String, body: String)
  case table(rows: [[String]])
  case rule
}

enum Md {
  static func parse(_ src: String) -> [MdBlock] {
    var out: [MdBlock] = []
    var para: [String] = []
    var lines = src.components(separatedBy: "\n")[...]

    func flush() {
      if !para.isEmpty { out.append(.para(para.joined(separator: "\n"))) }
      para = []
    }

    while let line = lines.popFirst() {
      let t = line.trimmingCharacters(in: .whitespaces)
      if t.hasPrefix("```") || t.hasPrefix("~~~") {
        flush()
        let fence = String(t.prefix(3))
        var body: [String] = []
        while let l = lines.popFirst(), !l.trimmingCharacters(in: .whitespaces).hasPrefix(fence) { body.append(l) }
        out.append(.code(lang: String(t.dropFirst(3)).trimmingCharacters(in: .whitespaces), body: body.joined(separator: "\n")))
      } else if t.hasPrefix("|") {
        flush()
        var rows = [cells(t)]
        while let l = lines.first, l.trimmingCharacters(in: .whitespaces).hasPrefix("|") {
          lines.removeFirst()
          let c = cells(l)
          if !c.allSatisfy({ $0.allSatisfy { "-: ".contains($0) } }) { rows.append(c) }
        }
        out.append(.table(rows: rows))
      } else if t.isEmpty {
        flush()
      } else if t.hasPrefix("#") {
        flush()
        out.append(.heading(String(t.drop { $0 == "#" }).trimmingCharacters(in: .whitespaces)))
      } else if t == "---" || t == "***" || t == "___" {
        flush()
        out.append(.rule)
      } else if t.hasPrefix(">") {
        flush()
        out.append(.quote(String(t.dropFirst()).trimmingCharacters(in: .whitespaces)))
      } else if let b = bullet(line) {
        flush()
        out.append(b)
      } else {
        para.append(line)
      }
    }
    flush()
    return out
  }

  private static func cells(_ row: String) -> [String] {
    var r = row.trimmingCharacters(in: .whitespaces)
    if r.hasPrefix("|") { r.removeFirst() }
    if r.hasSuffix("|") { r.removeLast() }
    return r.split(separator: "|", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
  }

  private static func bullet(_ line: String) -> MdBlock? {
    let indent = line.prefix { $0 == " " }.count
    let t = line.dropFirst(indent)
    if t.hasPrefix("- ") || t.hasPrefix("* ") || t.hasPrefix("+ ") {
      return .bullet(marker: "•", text: String(t.dropFirst(2)), depth: indent / 2)
    }
    let digits = t.prefix { $0.isNumber }
    if !digits.isEmpty, t.dropFirst(digits.count).hasPrefix(". ") {
      return .bullet(marker: "\(digits).", text: String(t.dropFirst(digits.count + 2)), depth: indent / 2)
    }
    return nil
  }

  static func inline(_ s: String) -> AttributedString {
    let opts = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
    return (try? AttributedString(markdown: s, options: opts)) ?? AttributedString(s)
  }
}

struct MdView: View {
  let blocks: [MdBlock]
  var font: Font = .system(size: 15)

  init(_ src: String, font: Font = .system(size: 15)) {
    self.blocks = Md.parse(src)
    self.font = font
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      ForEach(Array(blocks.enumerated()), id: \.offset) { _, b in
        block(b)
      }
    }
  }

  @ViewBuilder private func block(_ b: MdBlock) -> some View {
    switch b {
    case .para(let s):
      Text(Md.inline(s)).font(font)
    case .heading(let s):
      Text(Md.inline(s)).font(font.weight(.bold)).foregroundStyle(Theme.chrome)
    case .bullet(let m, let s, let depth):
      HStack(alignment: .firstTextBaseline, spacing: 4) {
        Text(m).foregroundStyle(Theme.sub)
        Text(Md.inline(s))
      }
      .font(font)
      .padding(.leading, CGFloat(depth) * 8)
    case .quote(let s):
      Text(Md.inline(s)).font(font.italic()).foregroundStyle(Theme.sub)
        .padding(.leading, 6)
        .overlay(alignment: .leading) { Rectangle().fill(Theme.muted).frame(width: 2) }
    case .code(let lang, let body):
      FoldChip(label: "{ } \(lang.isEmpty ? "code" : lang) · \(body.split(separator: "\n", omittingEmptySubsequences: false).count) lines") {
        Text(body).font(.system(size: 11, design: .monospaced))
      }
    case .table(let rows):
      FoldChip(label: "▦ table · \(max(rows.count - 1, 0)) rows") {
        VStack(alignment: .leading, spacing: 3) {
          ForEach(Array(rows.enumerated()), id: \.offset) { i, r in
            Text(Md.inline(r.joined(separator: " · ")))
              .font(.system(size: 12, weight: i == 0 ? .bold : .regular))
          }
        }
      }
    case .rule:
      Rectangle().fill(Theme.muted).frame(height: 1)
    }
  }
}

/// A folded block: one tappable line, expands in place.
struct FoldChip<Content: View>: View {
  let label: String
  @ViewBuilder let content: () -> Content
  @State private var open = false

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Button {
        open.toggle()
      } label: {
        HStack(spacing: 4) {
          Image(systemName: open ? "chevron.down" : "chevron.right").font(.system(size: 10))
          Text(label).font(.system(size: 12, design: .monospaced))
        }
        .foregroundStyle(Theme.live)
      }
      .buttonStyle(.plain)
      if open { content() }
    }
    .padding(6)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.muted.opacity(0.35), in: RoundedRectangle(cornerRadius: 6))
  }
}

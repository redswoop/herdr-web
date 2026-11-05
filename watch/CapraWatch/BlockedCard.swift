import SwiftUI

/// The watch side of web/src/components/BlockedCard.tsx — same answer bodies:
/// digits + expect for numbered menus, {option} cursor nav where digits get
/// swallowed (free-text rows, plan prompts, unnumbered menus), {feedback} for
/// the free-text row itself.
struct BlockedCard: View {
  let ctx: BlockedCtx
  let screen: String?
  let busy: Bool
  let answer: (AnswerBody) -> Void
  @State private var feedback = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      content
    }
    .padding(8)
    .background(Theme.alarm.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.alarm.opacity(0.6), lineWidth: 1))
    .disabled(busy)
  }

  @ViewBuilder private var content: some View {
    switch ctx {
    case .none:
      EmptyView()

    case .permission(let tool, let detail, let options):
      Text("🔒 \(tool)").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.alarm)
      if !detail.isEmpty { detailText(detail) }
      if let options, !options.isEmpty {
        ForEach(options) { o in
          option(o.label, tone: tone(o.label)) { answer(AnswerBody(keys: [String(o.n)], expect: String(o.label.prefix(30)))) }
        }
      } else {
        option("Yes, allow", tone: .yes) { answer(AnswerBody(keys: ["1"])) }
        option("Yes, don’t ask again", tone: .plain) { answer(AnswerBody(keys: ["2"])) }
        option("No", tone: .no) { answer(AnswerBody(keys: ["3"])) }
      }

    case .ask(let questions):
      ForEach(Array(questions.enumerated()), id: \.offset) { _, q in
        Text(q.question).font(.system(size: 14, weight: .semibold))
        ForEach(Array(q.options.enumerated()), id: \.offset) { i, o in
          option(o.label, sub: o.description, tone: .plain) {
            answer(AnswerBody(keys: [String(i + 1)], expect: String(o.label.prefix(30))))
          }
        }
        if q.multiSelect == true {
          option("done ⏎", tone: .yes) { answer(AnswerBody(keys: ["Enter"])) }
        }
      }

    case .menu(let question, let detail, let options, let byNav):
      if !detail.isEmpty { detailText(detail) }
      Text(question.isEmpty ? "choose an option" : question).font(.system(size: 14, weight: .semibold))
      ForEach(options.filter { $0.input != true }) { o in
        option((o.selected == true ? "❯ " : "") + o.label, sub: o.description, tone: tone(o.label)) {
          answer(byNav ? AnswerBody(option: o.n) : AnswerBody(keys: [String(o.n)], expect: String(o.label.prefix(30))))
        }
      }
      if options.contains(where: { $0.input == true }) { feedbackField("your own answer…") }

    case .plan(let plan, let question, let options):
      Text("📋 " + (question ?? "Proceed with the plan?")).font(.system(size: 14, weight: .semibold))
      if !plan.isEmpty {
        FoldChip(label: "the plan") { MdView(plan, font: .system(size: 13)) }
      }
      ForEach((options ?? []).filter { $0.input != true }) { o in
        option(o.label, tone: tone(o.label)) { answer(AnswerBody(option: o.n)) }
      }
      feedbackField("what to change…")

    case .unknown:
      Text("Blocked on something I can't parse").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.alarm)
      if let screen {
        let tail = screen.split(separator: "\n", omittingEmptySubsequences: false)
          .map { $0.trimmingCharacters(in: .whitespaces) }
          .filter { !$0.isEmpty }
          .suffix(14)
          .joined(separator: "\n")
        Text(tail).font(.system(size: 10, design: .monospaced)).foregroundStyle(Theme.sub)
      }
      HStack(spacing: 4) {
        ForEach(["1", "2", "3"], id: \.self) { k in
          Button(k) { answer(AnswerBody(keys: [k])) }.buttonStyle(Chip())
        }
        Button("⏎") { answer(AnswerBody(keys: ["Enter"])) }.buttonStyle(Chip())
        Button("esc") { answer(AnswerBody(keys: ["Escape"])) }.buttonStyle(Chip())
      }
    }
  }

  private func detailText(_ s: String) -> some View {
    Text(s.count > 600 ? String(s.prefix(600)) + "…" : s)
      .font(.system(size: 11, design: .monospaced))
      .foregroundStyle(Theme.sub)
      .lineLimit(10)
  }

  private func feedbackField(_ prompt: String) -> some View {
    TextField(prompt, text: $feedback)
      .onSubmit {
        let t = feedback.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        answer(AnswerBody(feedback: t))
        feedback = ""
      }
  }

  enum Tone { case yes, no, plain }

  private func tone(_ label: String) -> Tone {
    let l = label.lowercased()
    if l.hasPrefix("yes") || l.hasPrefix("approve") || l.hasPrefix("allow") { return .yes }
    if l.hasPrefix("no") || l.hasPrefix("quit") || l.hasPrefix("deny") { return .no }
    return .plain
  }

  private func option(_ label: String, sub: String? = nil, tone: Tone, action: @escaping () -> Void) -> some View {
    let c: Color = tone == .yes ? Theme.live : tone == .no ? Theme.chrome : Theme.text
    return Button(action: action) {
      VStack(alignment: .leading, spacing: 1) {
        Text(label).font(.system(size: 14, weight: .medium)).foregroundStyle(c)
          .multilineTextAlignment(.leading)
        if let sub, !sub.isEmpty {
          Text(sub).font(.system(size: 11)).foregroundStyle(Theme.sub).lineLimit(2)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .tint(c)
  }
}

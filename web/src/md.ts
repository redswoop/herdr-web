/* Tiny escape-first markdown: fenced code, inline code, bold, headers. */
export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export function md(src: string): string {
  const out: string[] = [];
  const parts = src.split(/```(\w*)\n?/);
  // parts alternate: text, lang, code, text, lang, code, ...
  for (let i = 0; i < parts.length; i += 1) {
    if (i % 3 === 2) {
      out.push(`<pre><code>${esc(parts[i])}</code></pre>`);
      continue;
    }
    if (i % 3 === 1) continue; // language tag
    let t = esc(parts[i]);
    t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/^#{1,3} (.*)$/gm, '<strong>$1</strong>');
    t = t.replace(/\n/g, '<br>');
    out.push(t);
  }
  return out.join('');
}

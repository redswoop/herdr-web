/* The kitchen-sink pane: a synthetic event stream that hits every transcript
 * node (prompt, thought + tool group, sent files with real images, a slash
 * command and a `!` bash pill, an error note, usage) and a reply built from
 * fixture.md, which leans on every markup form the parser does and doesn't
 * handle. Pick "kitchen sink" in the harness, or ?pane=fixture. */
import type { TEvent } from '@herdr/shared';
import md from './fixture.md?raw';

const ROOT = '/home/armen/src/herdr-web';
const t0 = Date.parse('2026-11-04T09:00:00Z');
const ts = (s: number) => new Date(t0 + s * 1000).toISOString();

export const FIXTURE_EVENTS: TEvent[] = [
  { kind: 'user', text: 'show me **everything** the transcript can render — tables, lists, `code`, images, the lot', ts: ts(0), msgId: 'u1' },
  { kind: 'thought', text: 'They want the kitchen sink. I will read the fixture, run a quick command, hand over two images, then write the reply.', ts: ts(1) },
  { kind: 'tool_use', name: 'Read', id: 't1', text: '', input: { file_path: `${ROOT}/web/src/webview/fixture.md` }, ts: ts(2) },
  { kind: 'tool_result', id: 't1', text: md.slice(0, 600) + '\n…', ts: ts(3) },
  { kind: 'tool_use', name: 'Bash', id: 't2', text: '', input: { command: 'ls -la mobile/assets/brand', description: 'List the brand assets' }, ts: ts(4) },
  { kind: 'tool_result', id: 't2', text: 'total 384\n-rw-rw-r-- 1 armen armen   2113 Oct 25 18:24 README.md\n-rw-rw-r-- 1 armen armen   9120 Oct 25 18:24 empty-sheep.png\n-rw-rw-r-- 1 armen armen 368452 Oct 25 18:24 goat-src.jpg', ts: ts(5) },
  { kind: 'tool_use', name: 'Grep', id: 't3', text: '', input: { pattern: 'kitchen', path: 'web/src/webview' }, ts: ts(6) },
  { kind: 'tool_result', id: 't3', text: 'web/src/webview/fixture.md:1:# Kitchen sink', ts: ts(7) },
  {
    kind: 'tool_use',
    name: 'SendUserFile',
    id: 't4',
    text: '',
    input: { files: [`${ROOT}/mobile/assets/brand/goat-src.jpg`, `${ROOT}/e2e/fixtures/pic.jpg`, `${ROOT}/PLAN-HTML-TRANSCRIPT.md`], caption: 'two pictures and a document, as a sent-files card' },
    ts: ts(8),
  },
  { kind: 'tool_result', id: 't4', text: 'sent', ts: ts(9) },
  { kind: 'assistant', text: md, ts: ts(12), msgId: 'a1', usage: { out: 2600, ctx: 81000 }, model: 'claude-fable-5-1', effort: 'high' },
  { kind: 'command', name: '/model', text: 'fable', ts: ts(20) },
  { kind: 'command_out', text: 'Set model to Fable 5.1 and saved as your default for new sessions', ts: ts(21) },
  { kind: 'command', name: '!', text: 'ls web/src/webview', ts: ts(25) },
  { kind: 'command_out', text: 'bridge.ts\nfixture.md\nfixture.ts\nfonts.ts\nharness.tsx\nmain.tsx\npage.css', ts: ts(26) },
  { kind: 'user', text: 'and a second turn, short', ts: ts(30), msgId: 'u2' },
  { kind: 'note', name: 'error', text: 'API Error: 529 overloaded (this is the fixture pretending)', ts: ts(31) },
  { kind: 'assistant', text: 'Second turn. One line, *no* fuss.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |', ts: ts(33), msgId: 'a2', usage: { out: 40, ctx: 81200 } },
];

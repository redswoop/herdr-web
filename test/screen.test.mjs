// Screen-grammar parsers against captured fixtures. The grok captures are
// verbatim pane reads from grok 4.5 (2026-08); the claude shapes match the
// grammars verified live against claude v2.1.2xx.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMenuScreen, parseGrokMenuScreen, parseMenuFor, isGrokProjectPicker,
  parseRewindScreen, parseMode, composerText, typedComposerText, trimSalvage,
} from '../lib/screen.js';

// ---------- claude ❯ menus ----------

// Verbatim pane capture, claude v2.1.220 (2026-08): the prompt sits under a
// horizontal rule with NO side borders, ❯ on the selected row.
const CLAUDE_PERMISSION = `
❯ Run this exact command with your Bash tool: touch claude-probe.txt
  Running 1 shell command…
  ⎿  $ touch claude-probe.txt
────────────────────────────────────────────────────────────────────
 Bash command
   touch claude-probe.txt
   Create empty claude-probe.txt file
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and always allow access to grok-lab/ from this project
   3. No
 Esc to cancel · Tab to amend · ctrl+e to explain
`;

test('claude permission menu parses options, question, detail', () => {
  const m = parseMenuScreen(CLAUDE_PERMISSION);
  assert.ok(m);
  assert.equal(m.options.length, 3);
  assert.deepEqual(m.options.map((o) => o.n), [1, 2, 3]);
  assert.equal(m.options[0].selected, true);
  assert.equal(m.options[1].selected, false);
  assert.equal(m.question, 'Do you want to proceed?');
  assert.match(m.detail, /touch claude-probe\.txt/);
});

test('claude plan prompt free-text row is flagged input', () => {
  const screen = `
 Would you like to proceed?
 ❯ 1. Yes, and auto-accept edits
   2. Yes, and manually approve edits
   3. Type here to tell Claude what to change
      shift+tab to approve with this feedback
`;
  const m = parseMenuScreen(screen);
  assert.ok(m);
  assert.equal(m.options[2].input, true);
  assert.equal(m.options[2].description, '');
});

test('numbered list in prose is not a menu (no cursor)', () => {
  const prose = `
  Here is my plan:
    1. First do the thing
    2. Then the other thing
`;
  assert.equal(parseMenuScreen(prose), null);
});

test('non-consecutive numbers are not a menu', () => {
  const screen = `
│ ❯ 1. option one
│   3. option three
`;
  assert.equal(parseMenuScreen(screen), null);
});

// ---------- grok radio menus ----------

const GROK_PERMISSION = `
  ┃
  ┃  Create probe-ok.txt via touch
  ┃  touch probe-ok.txt
  ┃
  ┃  1 (●) Yes, and don't ask again for anything (always-approve mode)
  ┃  2 (○) Yes, proceed
  ┃  3 (○) No, reject (type to add feedback)
  ┃
  1/3:select  │  Ctrl+o:always-approve  │  Ctrl+c:cancel
`;

test('grok permission menu parses options and question', () => {
  const m = parseGrokMenuScreen(GROK_PERMISSION);
  assert.ok(m);
  assert.deepEqual(m.options.map((o) => o.n), [1, 2, 3]);
  assert.equal(m.options[0].selected, true);
  assert.equal(m.options[1].label, 'Yes, proceed');
  assert.equal(m.question, 'touch probe-ok.txt');
  assert.match(m.detail, /Create probe-ok\.txt via touch/);
});

const GROK_ASK = `
  ┃
  ┃  Which color do you prefer?
  ┃
  ┃
  ┃  1 (○) Red    Prefer red                                        █
  ┃  2 (○) Green  Prefer green                                      █
  ┃  3 (○) Blue   Prefer blue                                       █
  ┃  z (○) Type your answer here
  ┃
  ┃  ↑/↓ navigate · y copy                              Enter:submit
  ┃
  Esc:unselect  │  Tab:scrollback  │  Shift+x:dismiss
`;

test('grok ask menu: label/description columns, free-text z row, scrollbar', () => {
  const m = parseGrokMenuScreen(GROK_ASK);
  assert.ok(m);
  const numbered = m.options.filter((o) => !o.input);
  assert.equal(numbered.length, 3);
  assert.equal(numbered[1].label, 'Green');
  assert.equal(numbered[1].description, 'Prefer green');
  const z = m.options.find((o) => o.input);
  assert.ok(z);
  assert.equal(m.question, 'Which color do you prefer?');
});

const GROK_PICKER = `
  ┃
  ┃  Run Grok Build in a project directory?
  ┃
  ┃  This gives Grok Build full context of your codebase for better results.
  ┃
  ┃  1 (○) grok-lab (current)  /tmp/scratch/grok-lab                █
  ┃  2 (○) herdr-web           ~/src/herdr-web  (55m ago)           █
  ┃  3 (○) Don't ask me again  Always start in the current directory█
  ┃  z (○) Type your answer here
  ┃
  ┃  ↑/↓ navigate · y copy                              Enter:submit
`;

test('grok project picker is detected and parses', () => {
  assert.equal(isGrokProjectPicker(GROK_PICKER), true);
  assert.equal(isGrokProjectPicker(GROK_ASK), false);
  const m = parseGrokMenuScreen(GROK_PICKER);
  assert.ok(m);
  assert.equal(m.options.filter((o) => !o.input).length, 3);
});

test('parseMenuFor picks the right grammar per kind and cross-falls-back', () => {
  assert.ok(parseMenuFor('grok', GROK_PERMISSION));
  assert.ok(parseMenuFor('claude', CLAUDE_PERMISSION));
  // wrong-kind screens still parse via fallback
  assert.ok(parseMenuFor('claude', GROK_PERMISSION));
  assert.ok(parseMenuFor('grok', CLAUDE_PERMISSION));
  assert.equal(parseMenuFor('grok', 'nothing here'), null);
});

test('grok TUI without a menu does not parse', () => {
  const idle = `
     Done — probe-ok.txt is created.
  ╭──────────────────────────────╮
  │ ❯                            │
  ╰──────────────────────────────╯
  Shift+Tab:mode  │  Ctrl+.:shortcuts
`;
  assert.equal(parseGrokMenuScreen(idle), null);
});

// ---------- rewind panel ----------

const REWIND_LIST = `
 Rewind

 ❯ fix the sidebar collapse
     2 files changed

   add tests for the adapter
     1 file changed

   (current)

 Enter to continue
`;

test('rewind checkpoint list parses', () => {
  const s = parseRewindScreen(REWIND_LIST);
  assert.equal(s.step, 'list');
  assert.equal(s.checkpoints.length, 3);
  assert.equal(s.checkpoints[0].selected, true);
  assert.equal(s.checkpoints[2].current, true);
  assert.match(s.checkpoints[0].detail, /2 files changed/);
});

test('rewind empty panel', () => {
  assert.deepEqual(parseRewindScreen(' Rewind\n\n Nothing to rewind to yet.'), { step: 'empty' });
});

test('rewind confirm step parses menu + message', () => {
  const s = parseRewindScreen(`
 Rewind

 Confirm you want to restore

 │ fix the sidebar collapse

 The code will be restored.
 The conversation will be rewound.

 ❯ 1. Restore code and conversation
   2. Restore conversation only
   3. Cancel
`);
  assert.equal(s.step, 'confirm');
  assert.equal(s.options.length, 3);
  assert.match(s.message, /fix the sidebar collapse/);
  assert.equal(s.effects.length, 2);
});

test('no rewind panel → null', () => {
  assert.equal(parseRewindScreen('just some\nscreen text'), null);
});

// ---------- mode footer ----------

test('parseMode reads footer strings, ignores scrollback mentions', () => {
  assert.equal(parseMode('stuff\n⏸ plan mode on · ← 2 agents'), 'plan');
  assert.equal(parseMode('stuff\n⏵⏵ accept edits on (shift+tab to cycle)'), 'acceptEdits');
  // a mode string quoted high in scrollback must not match (footer = last 6)
  const lines = ['⏸ plan mode on', ...Array.from({ length: 10 }, (_, i) => `line ${i}`)];
  assert.equal(parseMode(lines.join('\n')), 'unknown');
});

// ---------- composer & salvage ----------

test('composerText finds the last bare-❯ draft', () => {
  assert.equal(composerText('a\n❯ draft text here\nfooter'), 'draft text here');
  assert.equal(composerText('no prompt lines'), null);
});

// ANSI fixtures captured from claude v2.1.220 panes: user-typed composer text
// is UNSTYLED; claude paints its own hints/ghost suggestions in gray.
const E = '\x1b[';
test('typedComposerText: unstyled text is a real draft', () => {
  assert.equal(typedComposerText('scrollback\n❯ Repl\r'), 'Repl');
});

test('typedComposerText: empty composer (styled ❯ or bare) is no draft', () => {
  // verbatim sent-echo + bare composer from a live capture
  const echo = `${E}0m${E}38;2;80;80;80m${E}48;2;55;55;55m❯ ${E}0m${E}38;2;255;255;255m`
    + `${E}48;2;55;55;55mReply with just the word: ok${E}0m\r`;
  assert.equal(typedComposerText(`${echo}\n❯ \r`), '');
});

test('typedComposerText: gray ghost/predictive text does not count as a draft', () => {
  const ghost = `❯ ${E}38;2;153;153;153mTry "fix the failing tests"${E}0m\r`;
  assert.equal(typedComposerText(`stuff\n${ghost}`), '');
  const dim = `❯ ${E}2msuggested continuation${E}0m`;
  assert.equal(typedComposerText(dim), '');
});

test('typedComposerText: typed text survives next to ghost continuation', () => {
  const mixed = `❯ fix the${E}38;2;120;120;120m failing tests${E}0m`;
  assert.equal(typedComposerText(mixed), 'fix the');
});

test('trimSalvage cuts chrome, prompt echo, and grok scrollbar cells', () => {
  const screen = [
    '> Write an essay',
    '◆ Thought for 0.5s                        █',
    'The Enduring Craft of Sheep Herding       █',
    '',
    '╭──────────────╮',
    '│ ❯            │',
    '╰──────────────╯',
    'esc to interrupt',
  ].join('\n');
  const out = trimSalvage(screen, 'Write an essay about sheep');
  assert.ok(out);
  assert.match(out, /Enduring Craft/);
  assert.ok(!out.includes('█'));
  assert.ok(!out.includes('esc to interrupt'));
  assert.ok(!out.includes('Write an essay'));
});

test('trimSalvage returns null for pure chrome', () => {
  assert.equal(trimSalvage('╭───╮\n│ ❯ │\n╰───╯\n', null), null);
});

// Screen-grammar parsers against captured fixtures. The grok captures are
// verbatim pane reads from grok 4.5 (2026-08); the claude shapes match the
// grammars verified live against claude v2.1.2xx.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMenuScreen, parseCursorMenuScreen, parsePiMenuScreen, isPiInputDialog, parseGrokMenuScreen, parseMenuFor, isGrokProjectPicker, isGrokModalOverlay,
  isGrokPlanApproval, parseGrokPlanApproval,
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

// Verbatim pane capture, claude v2.1.312 (2026-10): `/model sonnet` mid-
// conversation. Dialogs here are topped by a ▔ rule, not ─ — missing it
// leaked the whole screen above into `detail`.
const CLAUDE_SWITCH_MODEL = `
❯ say just: hi

● hi

✻ Cogitated for 1s · done 8:38 PM

▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
   Switch model?

   Your next response will be slower and use more tokens

   This conversation is cached for the current model. Switching to Sonnet 5.5 means the full history gets re-read.

   ❯ 1. Yes, switch to Sonnet 5.5
     2. No, go back
`;

test('claude /model confirm parses, detail stops at the ▔ rule', () => {
  const m = parseMenuScreen(CLAUDE_SWITCH_MODEL);
  assert.ok(m);
  assert.deepEqual(m.options.map((o) => o.label), ['Yes, switch to Sonnet 5.5', 'No, go back']);
  assert.match(m.question, /full history gets re-read/);
  assert.equal(m.detail, 'Switch model?\nYour next response will be slower and use more tokens');
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

// Verbatim pane capture, claude v2.1.283 (2026-09): question 2 of a tabbed
// AskUserQuestion, after digit taps landed in the free-text row.
const CLAUDE_ASK_TYPED = `
────────────────────────────────────────────────────────────────────
←  ☒ Cousin door  ☐ Symptom  ✔ Submit  →

What is he seeing when it fails?

  1. Can't reach the box at all
     Page times out or the hostname doesn't resolve.
  2. Reaches it, gets refused
     A 403, 'no CG account', or a login prompt he can't pass.
  3. Old URL stopped working
     He's using a link from before the move.
  4. Don't know yet
     He just said it's broken.
❯ 5. 55636
────────────────────────────────────────────────────────────────────
  6. Chat about this

Enter to select · Tab/Arrow keys to navigate · ctrl+g to edit in VS Code · Esc to cancel
`;

test('claude ask menu flags the free-text row whatever was typed in it', () => {
  const m = parseMenuScreen(CLAUDE_ASK_TYPED);
  assert.ok(m);
  assert.equal(m.form, 'ask');
  assert.equal(m.question, 'What is he seeing when it fails?');
  assert.deepEqual(m.options.filter((o) => o.input).map((o) => o.n), [5]);
  assert.equal(m.options[4].selected, true);
  assert.equal(m.options[5].label, 'Chat about this');
  const placeholder = parseMenuScreen(CLAUDE_ASK_TYPED.replace('❯ 5. 55636', '  5. Type something.')
    .replace('  4. Don', '❯ 4. Don'));
  assert.deepEqual(placeholder.options.filter((o) => o.input).map((o) => o.n), [5]);
});

test('plain menus carry no form and no input row', () => {
  const m = parseMenuScreen(CLAUDE_PERMISSION);
  assert.equal(m.form, undefined);
  assert.ok(!m.options.some((o) => o.input));
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
  assert.equal(isGrokModalOverlay(idle), false);
});

// Grok's fullscreen message viewer (hit live 2026-08-07): modal, owns the
// pane, injected prompts land in it instead of the composer. Footer shape
// per the live capture; the [x] close marker sits top-right.
test('grok fullscreen viewer overlay is detected by its footer', () => {
  const viewer = `
  Messages                                                        [x]
  ────────────────────────────────────────────────────────────────────
  ❯ user: run the batch again with seed 42
    assistant: Kicking it off now — 4 items queued.
  ────────────────────────────────────────────────────────────────────
  Esc:close │ /:search │ f:filter │ v:select │ w:wrap │ r:raw
`;
  assert.equal(isGrokModalOverlay(viewer), true);
  // a transcript that merely QUOTES the footer string mid-screen must not
  // trip the detector — only the bottom chrome rows count
  const quoted = `
    assistant: the viewer footer says "Esc:close │ /:search" while open.
    More reply text continues here.
    And a few more lines of prose to push the quote out of the
    footer window entirely, well clear of the bottom rows.
  ╭──────────────────────────────╮
  │ ❯                            │
  ╰──────────────────────────────╯
  Shift+Tab:mode  │  Ctrl+.:shortcuts
`;
  assert.equal(isGrokModalOverlay(quoted), false);
});

// Grok plan-approval overlay — verbatim pane capture, grok 4.6 (2026-09).
// Letter-key action bar, not a radio menu; Esc does not dismiss.
const GROK_PLAN_APPROVAL = `
  ╭─ plan.md ──────────────────────────────────────────────────────── [↗] ╮
  │  1 Nuclear Minecraft                                                                    █│
  │    ● L1 a                                                                               █│
  │  2                                                                                      █│
  │  3 A datapack + resource pack, not a resource pack alone.                               █│
  │  9 1. Mine uranium, plutonium, lead, radium.                                             │
  │ 10 2. Raw radioactive stuff hurts you unless you're in full lead armor.                  │
  │──────────────────────────────────────────────────────────────────────────────────────────│
  │              a approve w/ comments  |  s request changes  |  c comment 1 ●  |  q quit plan │
  ╰──────────────────────────────────────────────────────────────────────────────────────────╯
    ◆ Waiting on plan approval

  ╭──────────────────────────────────────────────────────────────────────────────────────────╮
  │ ❯ Build anything                                                                         │
  ╰──────────────────────────────────────────────────────────────── Grok 4.6 (high) · plan approval ─╯

  c:comment  │  y:copy plan  │  s:send  │  q:quit plan  │  v:select  │  Tab:prompt
`;

test('grok plan approval overlay parses a/s/q options, not a radio menu', () => {
  assert.equal(isGrokPlanApproval(GROK_PLAN_APPROVAL), true);
  assert.equal(parseGrokMenuScreen(GROK_PLAN_APPROVAL), null);
  const p = parseGrokPlanApproval(GROK_PLAN_APPROVAL);
  assert.ok(p);
  assert.equal(p.kind, 'plan');
  assert.equal(p.dialect, 'grok');
  assert.equal(p.comments, 1);
  assert.equal(p.options[0].n, 1);
  assert.match(p.options[0].label, /approve with comments/i);
  assert.equal(p.options[1].input, true);
  assert.equal(p.options[2].n, 3);
  assert.match(p.options[2].label, /quit/i);
});

test('grok plan approval without pending comments is plain approve', () => {
  const screen = `
    ◆ Waiting on plan approval
    a approve  |  s request changes  |  c comment  |  q quit plan
    Grok 4.6 (high) · plan approval
    q:quit plan  │  Tab:prompt
  `;
  const p = parseGrokPlanApproval(screen);
  assert.ok(p);
  assert.equal(p.comments, 0);
  assert.match(p.options[0].label, /approve and start building/i);
  assert.equal(isGrokPlanApproval(GROK_PERMISSION), false);
  assert.equal(parseGrokPlanApproval(GROK_PERMISSION), null);
  assert.equal(isGrokPlanApproval(GROK_ASK), false);
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

// Verbatim pane capture, claude v2.1.288 (2026-10): the folder-trust prompt
// on a fresh spawn, drawn under the shell's launch line.
const CLAUDE_TRUST = `
🎯  herdr-web-trust-probe   main 󰋗 1  15:40
❯ claude

────────────────────────────────────────────────────────────────────
 Accessing workspace:

 /home/armen/.cache/herdr-web-trust-probe

 Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team). If not, take a moment to review what's in
 this folder first.

 Claude Code'll be able to read, edit, and execute files here.

 Security guide

 ❯ No, exit
   Yes, I trust this folder

 Enter to confirm · Esc to cancel
`;

test('claude folder-trust prompt parses as a nav-only cursor menu', () => {
  const m = parseMenuScreen(CLAUDE_TRUST);
  assert.ok(m);
  assert.equal(m.nav, true);
  assert.deepEqual(m.options.map((o) => [o.n, o.label, o.selected]), [
    [1, 'No, exit', true],
    [2, 'Yes, I trust this folder', false],
  ]);
  assert.equal(m.question, 'Accessing workspace: /home/armen/.cache/herdr-web-trust-probe');
  assert.match(m.detail, /review what's in this folder first\./);
  assert.doesNotMatch(m.detail, /claude$/m); // the shell line above the rule stays out
});

test('cursor menu needs the confirm footer at the bottom of the screen', () => {
  // an idle composer is a bare ❯ too
  assert.equal(parseCursorMenuScreen('some reply\n\n❯ draft text\n  ⏵⏵ auto mode on\n'), null);
  // footer scrolled into history, composer below it
  assert.equal(parseCursorMenuScreen(`${CLAUDE_TRUST}\n❯ \n  ? for shortcuts\n`), null);
  // numbered menus keep their own grammar (no nav flag)
  assert.equal(parseMenuScreen(CLAUDE_PERMISSION).nav, undefined);
});

// ---------- pi menus ----------
// Live captures from pi 1.3.0 (2026-10-28): ask-gate.ts's ctx.ui.select and
// its "why not?" ctx.ui.input, with pi's status rows under the footer.
const RULE = '─'.repeat(60);
const PI_CHROME = `${RULE}\n~/src/thing\n↑3.9k ↓55 3.0%/131k (auto)            qwen3.8-27b-heretic\n`;
const PI_GATE = `
 $ touch gate-probe.txt

${RULE}

 Run command?

 touch gate-probe.txt

 → Yes
   Yes, always allow touch this session
   No
   No, and tell it why…

 ↑↓ navigate  enter select  escape/ctrl+c cancel

${PI_CHROME}`;
const PI_WHY = `
 $ mkdir probe-dir
${RULE}
 Why not? (sent to the model)
>
 enter submit  escape/ctrl+c cancel
${PI_CHROME}`;

test('pi select: → cursor rows, nav-answered, command as detail', () => {
  const m = parseMenuFor('pi', PI_GATE);
  assert.equal(m.nav, true);
  assert.equal(m.question, 'Run command?');
  assert.equal(m.detail, 'touch gate-probe.txt');
  assert.deepEqual(m.options.map((o) => [o.n, o.label, o.selected]), [
    [1, 'Yes', true],
    [2, 'Yes, always allow touch this session', false],
    [3, 'No', false],
    [4, 'No, and tell it why…', false],
  ]);
});

test('pi select: footer must sit just above pi chrome; input box is not a menu', () => {
  // a footer quoted up in scrollback, live composer below
  assert.equal(parsePiMenuScreen(`${PI_GATE}\n reply\n\n reply\n\n reply\n${PI_CHROME}`), null);
  assert.equal(parsePiMenuScreen(PI_WHY), null);
  assert.equal(isPiInputDialog(PI_WHY), true);
  assert.equal(isPiInputDialog(PI_GATE), false);
});

// ---------- codex menus ----------
// /permissions and the idle screen are live captures from codex 0.162
// (2026-10). The approval prompt is RECONSTRUCTED from codex's documented
// layout, not captured — re-verify against a real one. Echo + composer share
// the › glyph with the menu cursor.

const CODEX_PERMISSIONS = `
› Use your shell tool to run: touch /tmp/x   Then say done.


• done

  Worked for 24s • 1:18 PM

  Update Model Permissions

  1. Ask for approval  Read and edit workspace files and run commands, with approval required for internet access or
                       edits outside the workspace
› 2. Approve for me    Only ask for actions detected as potentially unsafe
  3. Full Access       Use with caution: Codex can edit files outside this workspace and access the internet without
                       approval
  4. Read Only         Read workspace files, with approval required for edits or internet access

  enter select · esc back
`;

const CODEX_APPROVAL = `
› make the file

• I need to write outside the workspace:
  1. touch the file
  2. report back

  Would you like to run the following command?

  Reason: writes outside the workspace

  $ touch /tmp/cx-probe-outside.txt

› 1. Yes, proceed (y)
  2. Yes, and don't ask again for commands that start with \`touch /tmp/cx-probe-outside.txt\` (p)
  3. No, and tell Codex what to do differently (esc)

  Press enter to confirm or esc to cancel
`;

const CODEX_IDLE = `
› Use your shell tool to run: touch /tmp/x   Then say done.

• done

  Worked for 24s • 1:18 PM

› Ask Codex to do anything

  gpt-6.1-sol default · ~/src/herdr-web
  ? for shortcuts
`;

test('codex picker: same-row descriptions, wrapped continuations, › cursor', async () => {
  const { parseCodexMenuScreen } = await import('../lib/screen.js');
  const m = parseCodexMenuScreen(CODEX_PERMISSIONS);
  assert.equal(m.question, 'Update Model Permissions');
  assert.deepEqual(m.options.map((o) => [o.n, o.label, o.selected]), [
    [1, 'Ask for approval', false],
    [2, 'Approve for me', true],
    [3, 'Full Access', false],
    [4, 'Read Only', false],
  ]);
  assert.match(m.options[0].description, /internet access or edits outside the workspace$/);
  assert.match(m.options[2].description, /without approval$/);
});

test('codex approval prompt: question, command detail, prose lists ignored', async () => {
  const { parseMenuFor } = await import('../lib/screen.js');
  for (const kind of ['codex', 'claude', undefined]) {
    const m = parseMenuFor(kind, CODEX_APPROVAL);
    assert.equal(m.question, 'Would you like to run the following command?');
    assert.match(m.detail, /\$ touch \/tmp\/cx-probe-outside\.txt/);
    assert.equal(m.options.length, 3);
    assert.equal(m.options[0].label, 'Yes, proceed (y)');
    assert.equal(m.options[0].selected, true);
  }
});

// Verbatim capture, codex 0.162: first launch in a directory it hasn't seen.
const CODEX_TRUST = `
  Folder access
  /home/armen/src/thing

  Trust this folder? Codex can read, edit, and run files here, subject to your permission settings. Folder settings
  can run code automatically, even without a model request. Continue only if you trust these files. Your trust
  decision will be saved.

› 1. Trust and continue
  2. Quit

  enter continue · esc quit
`;

test('codex folder-trust dialog: the asking sentence is the question', async () => {
  const { parseMenuFor } = await import('../lib/screen.js');
  const m = parseMenuFor('codex', CODEX_TRUST);
  assert.equal(m.question, 'Trust this folder?');
  assert.match(m.detail, /^Codex can read, edit.*decision will be saved\.$/);
  assert.deepEqual(m.options.map((o) => o.label), ['Trust and continue', 'Quit']);
});

test('codex idle screen: no menu, composer is the last › line, chrome trims', async () => {
  const { parseMenuFor, codexComposerText, trimSalvage } = await import('../lib/screen.js');
  assert.equal(parseMenuFor('codex', CODEX_IDLE), null);
  assert.equal(codexComposerText(CODEX_IDLE), 'Ask Codex to do anything');
  assert.equal(trimSalvage(CODEX_IDLE, 'Use your shell tool to run'), '• done\n\n  Worked for 24s • 1:18 PM');
});

// Verbatim capture (trailing blanks trimmed), pi 1.3: idle after a turn.
const PI_IDLE = `
 The secret word is **quokka**.
 (Also, the directory contains just note.txt.)

────────────────────────────────────────────────────────────────────────────────
 Session name set: quokka hunt
────────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────────
/tmp/scratchpad/pilive • quokka hunt
↑613 ↓132 R2.9k CH98.4% 1.4%/131k (auto)                    qwen3.8-27b-heretic • medium
`;

test('pi screens: composer sits between the last two rules, footer is chrome', async () => {
  const { parseMenuFor, piComposerText, trimSalvage } = await import('../lib/screen.js');
  assert.equal(parseMenuFor('pi', PI_IDLE), null);
  assert.equal(piComposerText(PI_IDLE), '');
  assert.equal(piComposerText(PI_IDLE.replace('─\n\n─', '─\n Read note.txt please\n─')), 'Read note.txt please');
  assert.equal(
    trimSalvage(PI_IDLE.replace('Session name set: quokka hunt', '').replace(/\n─+\n\s*\n─+\n/, '\n'), 'x'),
    'The secret word is **quokka**.\n (Also, the directory contains just note.txt.)',
  );
  const working = ' read note.txt\n── ⠼ Working ─────────────────────────────\n──────────────────────\n~/src/app (main)\n1.1%/131k (auto)   m • medium\n';
  assert.equal(trimSalvage(working, 'x'), 'read note.txt');
});

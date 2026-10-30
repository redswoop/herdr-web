#!/usr/bin/env python3
"""Claude Code SessionStart hook: tell a claude session it runs under herdr
and how herdr-web renders its output (docs/agent-context.md).

Fires only inside a herdr pane (HERDR_ENV=1) and never for subagents. The doc
is read fresh on every session start, so editing docs/agent-context.md is all
it takes to teach every new session about a new client feature.

Usage:
  agent-context-hook.py             hook mode: hook JSON on stdin, JSON out
  agent-context-hook.py --print     show the context this environment would get
  agent-context-hook.py --install   add the hook to ~/.claude/settings.json
  agent-context-hook.py --uninstall remove it again

Debug: HERDR_AGENT_CONTEXT_DEBUG=1 writes a line to stderr.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DOC = os.path.join(os.path.dirname(HERE), 'docs', 'agent-context.md')
SETTINGS = os.path.join(os.path.expanduser('~'), '.claude', 'settings.json')
MATCHER = '^(startup|resume|clear|compact|fork)$'
MARK = 'herdr-web agent context'  # how --install recognises its own entry

COND = re.compile(r'<!-- if:(\w+) -->\n?(.*?)<!-- endif -->\n?', re.S)
COMMENT = re.compile(r'<!--(?!\s*if:)(?!\s*endif).*?-->\n?', re.S)


def dbg(msg):
    if os.environ.get('HERDR_AGENT_CONTEXT_DEBUG'):
        print(f'agent-context-hook: {msg}', file=sys.stderr)


def facts():
    """What varies between sessions. SendUserFile only exists when the session
    is bridged to claude.ai; the bridge id in the env is the reliable tell."""
    return {
        'bridge': bool(os.environ.get('CLAUDE_CODE_BRIDGE_SESSION_ID')),
        'nobridge': not os.environ.get('CLAUDE_CODE_BRIDGE_SESSION_ID'),
    }


def render(doc, f):
    doc = COMMENT.sub('', doc)
    doc = COND.sub(lambda m: m.group(2) if f.get(m.group(1)) else '', doc)
    return re.sub(r'\n{3,}', '\n\n', doc).strip() + '\n'


def context():
    with open(DOC, encoding='utf-8') as fh:
        return render(fh.read(), facts())


def hook():
    if os.environ.get('HERDR_ENV') != '1':
        dbg('not a herdr pane; skipping')
        return
    try:
        inp = json.loads(sys.stdin.read() or '{}')
    except Exception:
        inp = {}
    if inp.get('agent_id'):
        dbg('subagent; skipping')
        return
    if inp.get('hook_event_name', 'SessionStart') != 'SessionStart':
        return
    try:
        ctx = context()
    except OSError as e:
        dbg(f'no doc: {e}')
        return
    json.dump({'hookSpecificOutput': {'hookEventName': 'SessionStart', 'additionalContext': ctx}}, sys.stdout)
    dbg(f'injected {len(ctx)} chars, bridge={facts()["bridge"]}')


def entry():
    return {
        'matcher': MATCHER,
        'hooks': [{'type': 'command', 'command': f'python3 "{os.path.abspath(__file__)}"  # {MARK}', 'timeout': 10}],
    }


def is_ours(h):
    return any(MARK in (x.get('command') or '') for x in h.get('hooks', []))


def install(remove=False):
    try:
        with open(SETTINGS, encoding='utf-8') as fh:
            s = json.load(fh)
    except FileNotFoundError:
        s = {}
    hooks = s.setdefault('hooks', {}).setdefault('SessionStart', [])
    hooks[:] = [h for h in hooks if not is_ours(h)]
    if not remove:
        hooks.append(entry())
    with open(SETTINGS, 'w', encoding='utf-8') as fh:
        json.dump(s, fh, indent=2)
        fh.write('\n')
    print(('removed from' if remove else 'installed into') + ' ' + SETTINGS)


if __name__ == '__main__':
    arg = sys.argv[1] if len(sys.argv) > 1 else ''
    if arg == '--print':
        sys.stdout.write(context())
    elif arg == '--install':
        install()
    elif arg == '--uninstall':
        install(remove=True)
    else:
        hook()

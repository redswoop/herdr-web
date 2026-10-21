/* Rename / close for agents and workspaces — the TUI's verbs, reached from a
   long-press on a list row or group header and from the agent header's menu.
   Native sheets and prompts: they're quick, keyboard-correct and the user
   already knows them. */
import { ActionSheetIOS, Alert, Platform } from 'react-native';
import { chipName, closeAgent, closeWorkspace, describeError, errorOf, renameAgent, renameWorkspace, type Agent } from '@herdr/shared';
import { tick, toast } from './toast';

function sheet(title: string, options: { label: string; destructive?: boolean; run: () => void }[]) {
  const labels = [...options.map((o) => o.label), 'Cancel'];
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        options: labels,
        cancelButtonIndex: labels.length - 1,
        destructiveButtonIndex: options.findIndex((o) => o.destructive),
      },
      (i) => options[i]?.run(),
    );
  } else {
    Alert.alert(title, undefined, [
      ...options.map((o) => ({ text: o.label, style: o.destructive ? ('destructive' as const) : undefined, onPress: o.run })),
      { text: 'Cancel', style: 'cancel' },
    ]);
  }
}

function prompt(title: string, message: string, initial: string, onText: (t: string) => void) {
  if (Platform.OS === 'ios') {
    Alert.prompt(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: 'Rename', onPress: (t?: string) => t && onText(t) }], 'plain-text', initial);
  } else {
    // Android's Alert has no text field; the launcher's name field is the fallback there
    toast('rename needs iOS for now');
  }
}

async function run(label: string, p: Promise<Response>) {
  try {
    const r = await p;
    if (!r.ok) throw new Error(await errorOf(r));
    tick();
    toast(label);
    return true;
  } catch (e) {
    Alert.alert('herdr said no', describeError(e));
    return false;
  }
}

/** long-press on an agent: rename or close */
export function agentMenu(a: Agent, opts: { onOpen?: () => void; onClosed?: () => void } = {}) {
  const name = chipName(a);
  const options = [];
  if (opts.onOpen) options.push({ label: 'Open', run: opts.onOpen });
  options.push({
    label: 'Rename…',
    run: () => prompt('Rename', 'The tab and the agent both take the new name.', name, (text) => void run('renamed', renameAgent(a.paneId, text))),
  });
  options.push({
    label: a.status === 'working' ? 'Close agent (it is working)' : 'Close agent',
    destructive: true,
    run: () =>
      Alert.alert(`Close ${name}?`, 'Ends the agent and its pane. The session file stays on disk for /resume.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close',
          style: 'destructive',
          onPress: async () => {
            if (await run('closed', closeAgent(a.paneId))) opts.onClosed?.();
          },
        },
      ]),
  });
  sheet(name, options);
}

/** long-press on a workspace header: rename or close the whole space */
export function workspaceMenu(workspaceId: string, title: string, agentCount: number) {
  sheet(title, [
    {
      label: 'Rename space…',
      run: () => prompt('Rename space', 'herdr shows this on the workspace tab.', title, (text) => void run('renamed', renameWorkspace(workspaceId, text))),
    },
    {
      label: agentCount ? `Close space (${agentCount} agent${agentCount === 1 ? '' : 's'})` : 'Close space',
      destructive: true,
      run: () =>
        Alert.alert(`Close ${title}?`, 'Every pane in it ends. Session files stay on disk for /resume.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Close', style: 'destructive', onPress: () => void run('closed', closeWorkspace(workspaceId)) },
        ]),
    },
  ]);
}

import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import {
  agentPath,
  applyEvents,
  createAtClock,
  errorOf,
  get,
  stampEvents,
  type Item,
  type TEvent,
} from '@herdr/shared';
import { Transcript, transcriptDebug } from '../src/components/Transcript';
import { useStyles, type Tokens } from '../src/theme';

/* Render lab, part two: replay a real pane's transcript through the real
   <Transcript> the way useAgentSession feeds it — one bulk apply for the
   history, then the tail event-by-event with the working flag flipping at
   turn boundaries. The static lab (lab.tsx) never boxes; the live transcript
   does, so the trigger is in the update sequence, and this reproduces it on
   demand without waiting for a real agent.

   capra://replay?pane=w3K:p1          replay, streaming the last 2 turns
   capra://replay?pane=w3K:p1&turns=4  stream the last 4 turns
   capra://replay?pane=w3K:p1&ms=20    20ms between tail events (default 60)
   capra://replay?pane=w3K:p1&loop=1   re-run forever (pane stays mounted)
   capra://replay?pane=w3K:p1&end=290  only the first 290 events
   &nomvcp=1 / &noinv=1                FlatList knobs; cell heights go to Metro as [cell] lines */

const noop = () => {};

export default function ReplayScreen() {
  const styles = useStyles(makeStyles);
  const params = useLocalSearchParams<{ pane?: string; turns?: string; ms?: string; loop?: string; end?: string; nomvcp?: string; noinv?: string }>();
  const pane = params.pane ?? '';
  const turns = Math.max(1, Number(params.turns) || 2);
  const ms = Math.max(0, Number(params.ms) || 60);
  const loop = params.loop === '1';
  const end = Number(params.end) || 0; // stop after this many events (0 = all)

  const [items, setItems] = useState<Item[]>([]);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState('loading…');
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef(0);

  useEffect(() => {
    let alive = true;
    transcriptDebug.log = true;
    transcriptDebug.noMvcp = params.nomvcp === '1';
    transcriptDebug.noInverted = params.noinv === '1';
    console.log(`[replay] knobs nomvcp=${transcriptDebug.noMvcp} noinv=${transcriptDebug.noInverted}`);
    const sleep = (t: number) => new Promise((r) => setTimeout(r, t));
    const run = async () => {
      if (!pane) {
        setError('no ?pane=');
        return;
      }
      let events: TEvent[];
      try {
        const r = await get(agentPath(pane, 'transcript'));
        if (!r.ok) throw new Error(await errorOf(r));
        events = ((await r.json()) as { events: TEvent[] }).events;
        if (end > 0) events = events.slice(0, end);
      } catch (e) {
        setError(String((e as Error).message ?? e));
        return;
      }
      // cut point: the user prompt that starts the Nth-from-last turn
      const prompts: number[] = [];
      events.forEach((ev, i) => ev.kind === 'user' && prompts.push(i));
      const cut = prompts.length > turns ? prompts[prompts.length - turns] : 0;
      let pass = 0;
      do {
        pass += 1;
        if (!alive) return;
        const clock = createAtClock();
        const nextKey = () => keyRef.current++;
        setWorking(false);
        setItems([]);
        await sleep(50);
        // history arrives as one GET → one apply (exactly like the hook)
        const head = stampEvents(events.slice(0, cut), nextKey, clock);
        setItems((prev) => applyEvents(prev, head));
        setStatus(`pass ${pass} · history ${cut}/${events.length}`);
        await sleep(400);
        for (let i = cut; i < events.length; i++) {
          if (!alive) return;
          const ev = events[i];
          if (ev.kind === 'user') {
            // the previous turn ends before the next prompt lands: pill off,
            // meta footer in, then the user bubble — the status change is a
            // separate roster tick in the real app, so give it its own frame
            setWorking(false);
            await sleep(Math.max(ms, 16));
          }
          const stamped = stampEvents([ev], nextKey, clock);
          setItems((prev) => applyEvents(prev, stamped));
          if (ev.kind === 'user' || ev.kind === 'tool_use' || ev.kind === 'thought' || ev.kind === 'assistant') {
            setWorking(true);
          }
          setStatus(`pass ${pass} · ${i + 1}/${events.length} ${ev.kind}`);
          await sleep(ms);
        }
        setWorking(false);
        setStatus(`pass ${pass} · done ${events.length} events (${turns} turns streamed)`);
        console.log(`[replay] done pass ${pass}: ${events.length} events, cut=${cut}`);
        events.slice(Math.max(0, events.length - 12)).forEach((ev, j) =>
          console.log(`[replay] ev${events.length - 12 + j} ${ev.kind} ${ev.name ?? ''} ${ev.text.length}ch ${JSON.stringify(ev.text.slice(0, 50))}`),
        );
        await sleep(1500);
      } while (loop && alive);
    };
    run();
    return () => {
      alive = false;
      transcriptDebug.log = false;
    };
  }, [pane, turns, ms, loop, end, params.nomvcp, params.noinv]);

  return (
    <View style={styles.root}>
      <Text style={styles.hint}>
        replay {pane || '?'} · {status}
        {error ? ` · error: ${error}` : ''}
      </Text>
      <Transcript
        items={items}
        error={error}
        loaded
        working={working}
        cancellableKey={null}
        onInterrupt={noop}
        onOpenFile={noop}
      />
    </View>
  );
}

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
  root: { flex: 1, backgroundColor: t.colors.bg },
  hint: { ...t.font('ui'), color: t.colors.sub, fontSize: 11, paddingHorizontal: 14, paddingVertical: 4 },
});

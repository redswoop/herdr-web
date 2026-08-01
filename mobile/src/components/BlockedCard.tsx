import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { BlockedCtx } from '@herdr/shared';
import { colors, radius } from '../theme';

export function BlockedCard({
  ctx,
  onAnswer,
}: {
  ctx: BlockedCtx;
  onAnswer: (keys: string[], expect: string | null) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const answer = async (id: string, keys: string[], expect: string | null) => {
    setBusy(id);
    try {
      await onAnswer(keys, expect);
    } finally {
      setBusy(null);
    }
  };

  const opt = (
    id: string,
    label: string,
    keys: string[],
    { desc, expect, cls }: { desc?: string; expect?: string | null; cls?: string } = {},
  ) => (
    <Pressable
      key={id}
      style={[
        styles.option,
        cls === 'confirm' && styles.confirm,
        cls === 'deny' && styles.deny,
        busy === id && styles.busy,
      ]}
      disabled={busy !== null}
      onPress={() => answer(id, keys, expect ?? null)}
    >
      {busy === id ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <>
          <Text style={styles.optLabel}>{label}</Text>
          {!!desc && <Text style={styles.optDesc}>{desc}</Text>}
        </>
      )}
    </Pressable>
  );

  if (ctx.kind === 'ask') {
    return (
      <View style={styles.card}>
        {ctx.questions.map((q, qi) => (
          <View key={qi} style={styles.question}>
            <Text style={styles.qText}>{q.question}</Text>
            {q.options.map((o, i) =>
              opt(`${qi}:${i}`, o.label, [String(i + 1)], {
                desc: o.description,
                expect: o.label.slice(0, 30),
              }),
            )}
            {q.multiSelect &&
              opt(`${qi}:done`, 'done ⏎ (multi-select: taps toggle)', ['Enter'], {
                cls: 'confirm',
              })}
          </View>
        ))}
      </View>
    );
  }

  if (ctx.kind === 'menu') {
    return (
      <View style={styles.card}>
        <View style={styles.question}>
          {!!ctx.detail && <Text style={styles.detail}>{ctx.detail}</Text>}
          <Text style={styles.qText}>{ctx.question || ctx.header || 'choose an option'}</Text>
          {ctx.options.map((o) =>
            opt(String(o.n), `${o.selected ? '❯ ' : ''}${o.label}`, [String(o.n)], {
              desc: o.description,
              expect: o.label.slice(0, 30),
            }),
          )}
        </View>
      </View>
    );
  }

  if (ctx.kind === 'permission') {
    return (
      <View style={styles.card}>
        <View style={styles.question}>
          <Text style={styles.qText}>
            🔒 wants to run <Text style={styles.tool}>{ctx.tool}</Text>
          </Text>
          {!!ctx.detail && (
            <Text style={styles.detail} numberOfLines={20}>
              {ctx.detail.slice(0, 2000)}
            </Text>
          )}
          {ctx.options?.length
            ? ctx.options.map((o) =>
                opt(String(o.n), o.label, [String(o.n)], {
                  desc: o.description,
                  expect: o.label.slice(0, 30),
                  cls: /^yes/i.test(o.label) ? 'confirm' : /^no/i.test(o.label) ? 'deny' : '',
                }),
              )
            : [
                opt('y', 'Yes', ['1'], { cls: 'confirm', expect: 'Yes' }),
                opt('n', 'No', ['2'], { cls: 'deny', expect: 'No' }),
              ]}
        </View>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.blocked,
    padding: 12,
    gap: 10,
  },
  question: { gap: 8 },
  qText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  detail: {
    fontFamily: 'monospace',
    color: colors.sub,
    fontSize: 12,
    backgroundColor: colors.surface2,
    padding: 8,
    borderRadius: radius.sm,
  },
  tool: { color: colors.accent, fontFamily: 'monospace' },
  option: {
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  confirm: { borderColor: colors.done },
  deny: { borderColor: colors.blocked },
  busy: { opacity: 0.6 },
  optLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  optDesc: { color: colors.sub, fontSize: 12, marginTop: 2 },
});

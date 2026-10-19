import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AnswerBody, BlockedCtx } from '@herdr/shared';
import { Brackets, HazardTape } from '../cyber';
import { alpha, mix, useStyles, useTheme, type Tokens } from '../theme';
import { Icon } from './Icon';

export function BlockedCard({
  ctx,
  onAnswer,
}: {
  ctx: BlockedCtx;
  onAnswer: (body: AnswerBody) => Promise<boolean>;
}) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const [busy, setBusy] = useState<string | null>(null);
  const [fb, setFb] = useState('');

  const answer = async (id: string, body: AnswerBody) => {
    setBusy(id);
    try {
      return await onAnswer(body);
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
      onPress={() => answer(id, { keys, expect: expect ?? null })}
    >
      {busy === id ? (
        <ActivityIndicator color={t.colors.text} />
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
        <HazardTape style={styles.tape} />
        <Brackets color={t.colors.blocked} />
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
    // A free-text row swallows digits once ❯ sits on it, so a menu that has
    // one answers by cursor nav and gets a real text field for that row.
    const hasInput = ctx.options.some((o) => o.input);
    // …and an unnumbered cursor menu (folder-trust prompt) has no digits at all
    const byNav = hasInput || !!ctx.nav;
    return (
      <View style={styles.card}>
        <HazardTape style={styles.tape} />
        <Brackets color={t.colors.blocked} />
        <View style={styles.question}>
          {!!ctx.detail && <Text style={styles.detail}>{ctx.detail}</Text>}
          <Text style={styles.qText}>{ctx.question || ctx.header || 'choose an option'}</Text>
          {ctx.options
            .filter((o) => !o.input)
            .map((o) =>
              byNav ? (
                <Pressable
                  key={String(o.n)}
                  style={[styles.option, busy === String(o.n) && styles.busy]}
                  disabled={busy !== null}
                  onPress={() => answer(String(o.n), { option: o.n })}
                >
                  {busy === String(o.n) ? (
                    <ActivityIndicator color={t.colors.text} />
                  ) : (
                    <>
                      <Text style={styles.optLabel}>{`${o.selected ? '❯ ' : ''}${o.label}`}</Text>
                      {!!o.description && <Text style={styles.optDesc}>{o.description}</Text>}
                    </>
                  )}
                </Pressable>
              ) : (
                opt(String(o.n), `${o.selected ? '❯ ' : ''}${o.label}`, [String(o.n)], {
                  desc: o.description,
                  expect: o.label.slice(0, 30),
                })
              ),
            )}
          {hasInput && (
            <>
              <TextInput
                style={styles.fb}
                placeholder="type your own answer…"
                placeholderTextColor={t.colors.sub}
                value={fb}
                editable={busy === null}
                multiline
                onChangeText={setFb}
              />
              <Pressable
                style={[styles.option, busy === 'fb' && styles.busy]}
                disabled={busy !== null || !fb.trim()}
                onPress={async () => {
                  if (await answer('fb', { feedback: fb.trim() })) setFb('');
                }}
              >
                {busy === 'fb' ? (
                  <ActivityIndicator color={t.colors.text} />
                ) : (
                  <Text style={styles.optLabel}>send answer</Text>
                )}
              </Pressable>
            </>
          )}
        </View>
      </View>
    );
  }

  if (ctx.kind === 'plan') {
    const grok = ctx.dialect === 'grok';
    const choices = (ctx.options ?? []).filter((o) => !o.input);
    const clsOf = (label: string) =>
      /^(yes|approve)/i.test(label) ? 'confirm' : /^(no|quit)/i.test(label) ? 'deny' : '';
    return (
      <View style={styles.card}>
        <HazardTape style={styles.tape} />
        <Brackets color={t.colors.blocked} />
        <View style={styles.question}>
          <Text style={styles.qText}>
            {ctx.question || (grok ? 'Grok has a plan — proceed?' : 'Claude has a plan — proceed?')}
          </Text>
          {!!ctx.plan && (
            <Text style={styles.detail} numberOfLines={24}>
              {ctx.plan}
            </Text>
          )}
          {choices.map((o) => (
            <Pressable
              key={String(o.n)}
              style={[
                styles.option,
                clsOf(o.label) === 'confirm' && styles.confirm,
                clsOf(o.label) === 'deny' && styles.deny,
                busy === String(o.n) && styles.busy,
              ]}
              disabled={busy !== null}
              onPress={() => answer(String(o.n), { option: o.n })}
            >
              {busy === String(o.n) ? (
                <ActivityIndicator color={t.colors.text} />
              ) : (
                <>
                  <Text style={styles.optLabel}>{o.label}</Text>
                  {!!o.description && <Text style={styles.optDesc}>{o.description}</Text>}
                </>
              )}
            </Pressable>
          ))}
          <TextInput
            style={styles.fb}
            placeholder={grok ? 'tell grok what to change…' : 'tell claude what to change…'}
            placeholderTextColor={t.colors.sub}
            value={fb}
            editable={busy === null}
            multiline
            onChangeText={setFb}
          />
          <Pressable
            style={[styles.option, styles.deny, busy === 'fb' && styles.busy]}
            disabled={busy !== null || !fb.trim()}
            onPress={async () => {
              if (await answer('fb', { feedback: fb.trim() })) setFb('');
            }}
          >
            {busy === 'fb' ? (
              <ActivityIndicator color={t.colors.text} />
            ) : (
              <Text style={styles.optLabel}>send feedback (keeps planning)</Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  if (ctx.kind === 'permission') {
    return (
      <View style={styles.card}>
        <HazardTape style={styles.tape} />
        <Brackets color={t.colors.blocked} />
        <View style={styles.question}>
          <View style={styles.qRow}>
            <Icon name="lock" size={16} color={t.colors.blocked} />
            <Text style={styles.qText}>
              wants to run <Text style={styles.tool}>{ctx.tool}</Text>
            </Text>
          </View>
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

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
  card: {
    backgroundColor: t.cyber ? alpha(t.colors.surface, 0.96) : t.colors.surface,
    borderTopWidth: t.cyber ? 0 : StyleSheet.hairlineWidth,
    borderTopColor: t.colors.blocked,
    padding: 12,
    gap: 10,
    ...t.boxGlow(t.colors.blocked, 30, 0.35),
  },
  tape: { marginHorizontal: -12, marginTop: -12, marginBottom: 4 },
  question: { gap: 8 },
  qRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qText: { color: t.cyber ? mix(t.colors.text, '#ffffff', 0.5) : t.colors.text, fontSize: 15, ...t.font('ui', '600'), flex: 1, ...t.phosphor },
  detail: {
    ...t.font('mono'),
    color: t.cyber ? mix(t.colors.accent, t.colors.text, 0.55) : t.colors.sub,
    fontSize: 12,
    backgroundColor: t.cyber ? alpha('#000000', 0.5) : t.colors.surface2,
    borderLeftWidth: t.cyber ? 2 : 0,
    borderLeftColor: t.colors.accent,
    padding: 8,
    borderRadius: t.radius.sm,
  },
  tool: { color: t.colors.accent, ...t.font('mono'), },
  option: {
    backgroundColor: t.cyber ? alpha(t.colors.accent, 0.08) : t.colors.surface2,
    borderRadius: t.radius.md,
    padding: 12,
    borderWidth: t.cyber ? 0 : 1,
    borderColor: t.colors.hairline,
    borderLeftWidth: t.cyber ? 2 : 1,
    borderLeftColor: t.cyber ? t.colors.accent : t.colors.hairline,
  },
  confirm: t.cyber
    ? { borderLeftColor: t.colors.done, backgroundColor: alpha(t.colors.done, 0.14) }
    : { borderColor: t.colors.done },
  deny: t.cyber
    ? { borderLeftColor: t.colors.red, backgroundColor: alpha(t.colors.red, 0.14) }
    : { borderColor: t.colors.blocked },
  busy: { opacity: 0.6 },
  optLabel: { color: t.colors.text, fontSize: 15, ...t.font('ui', '600') },
  optDesc: { ...t.font('ui'), color: t.colors.sub, fontSize: 12, marginTop: 2 },
  fb: {
    backgroundColor: t.cyber ? alpha('#000000', 0.45) : t.colors.surface2,
    borderWidth: t.cyber ? 1 : 0,
    borderColor: alpha(t.colors.accent, 0.25),
    color: t.colors.text,
    borderRadius: t.radius.md,
    padding: 10,
    minHeight: 48,
    ...t.font('ui'),
    fontSize: 14,
  },
});

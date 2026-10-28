import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ApiError, smsStart, smsVerify } from '@/api/client';
import { RoundButton } from '@/components/round-button';
import { Screen } from '@/components/screen';
import { Txt } from '@/components/txt';
import { refreshToday, useAppStore } from '@/store/app-store';
import { font, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

const LEN = 4;

/** «+77071234567» → «+7 707 123 45 67» */
function pretty(phone: string) {
  const d = phone.replace(/\D/g, '').slice(1);
  return `+7 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8, 10)}`;
}

export default function Code() {
  const c = useColors();
  const { phone = '', mode, delivery } = useLocalSearchParams<{ phone: string; mode?: 'login' | 'signup'; delivery?: 'sms' | 'manual' }>();
  // Пилот без SMS: код заранее прислала команда, отправлять повторно нечего
  const manual = delivery === 'manual';
  const { state, dispatch } = useAppStore();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(60);
  const input = useRef<ComponentRef<typeof TextInput>>(null);

  // Обратный отсчёт до повторной отправки
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  // После неверного кода возвращаем клавиатуру — когда поле снова доступно для ввода
  useEffect(() => {
    if (error && !busy) input.current?.focus();
  }, [error, busy]);

  async function verify(value: string) {
    setBusy(true);
    setError(null);
    try {
      // При входе по существующему номеру сервер данные регистрации игнорирует
      const signup = mode === 'login' ? { role: 'client' as const } : { ...state.signup, goal: state.goal };
      const r = await smsVerify(phone, value, signup);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      dispatch({ type: 'setMe', me: r.me });
      dispatch({ type: 'finishOnboarding' });
      refreshToday(dispatch);
      router.dismissAll();
      router.replace(r.me.pro ? '/pro' : '/today');
      if (r.join_message) Alert.alert('Код не подошёл', r.join_message);
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(e instanceof ApiError ? e.message : 'Не получилось проверить код. Попробуйте ещё раз.');
      setCode('');
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      await smsStart(phone);
      setWait(60);
    } catch (e) {
      if (e instanceof ApiError && e.retryAfter) setWait(e.retryAfter);
      setError(e instanceof ApiError ? e.message : 'Не получилось отправить код.');
    }
  }

  return (
    <Screen>
      <RoundButton icon="back" label="Назад" onPress={() => router.back()} />
      <View style={{ gap: space[2] }}>
        <Txt variant="display">{manual ? 'Код входа' : 'Код из SMS'}</Txt>
        <Txt tone="muted">
          {manual ? `Код для ${pretty(phone)} прислала команда Nutrivia в WhatsApp` : `Отправили на ${pretty(phone)}`}
        </Txt>
      </View>

      <Pressable onPress={() => input.current?.focus()} accessibilityLabel={manual ? 'Поле для кода входа' : 'Поле для кода из SMS'} style={styles.cells}>
        {Array.from({ length: LEN }, (_, i) => {
          const active = i === code.length && !busy;
          return (
            <View
              key={i}
              style={[styles.cell, { backgroundColor: c.surface, borderColor: error ? c.warning : active ? c.ink : 'transparent' }]}>
              <Txt style={{ fontFamily: font.bold, fontSize: 28, lineHeight: 34 }}>{code[i] ?? ''}</Txt>
            </View>
          );
        })}
      </Pressable>
      {/* Невидимое поле: принимает ввод и автоподстановку кода из SMS (iOS oneTimeCode) */}
      <TextInput
        ref={input}
        value={code}
        onChangeText={(v) => {
          const d = v.replace(/\D/g, '').slice(0, LEN);
          setCode(d);
          setError(null);
          if (d.length === LEN) verify(d);
        }}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        autoFocus
        editable={!busy}
        maxLength={LEN}
        style={styles.hidden}
      />

      {error && <Txt variant="caption" tone="warning">{error}</Txt>}
      {busy && <Txt variant="caption" tone="muted">Проверяем…</Txt>}

      {manual ? (
        <Txt variant="caption" tone="muted">Нет кода или он не подходит — напишите команде Nutrivia, пришлём новый.</Txt>
      ) : (
        <Pressable accessibilityRole="button" disabled={wait > 0} onPress={resend} style={styles.resend}>
          <Txt variant="headline" style={{ fontSize: 15, color: wait > 0 ? c.muted : c.greenText }}>
            {wait > 0 ? `Отправить ещё раз через ${wait} с` : 'Отправить код ещё раз'}
          </Txt>
        </Pressable>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cells: { flexDirection: 'row', gap: space[3] },
  cell: { flex: 1, height: 68, borderRadius: radius.m, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  hidden: { position: 'absolute', opacity: 0, width: 1, height: 1 },
  resend: { minHeight: 44, justifyContent: 'center' },
});

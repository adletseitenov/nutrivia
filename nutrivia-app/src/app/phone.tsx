import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ApiError, smsStart } from '@/api/client';
import { Button } from '@/components/button';
import { RoundButton } from '@/components/round-button';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { Txt } from '@/components/txt';
import { useAppStore } from '@/store/app-store';
import { space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

/** 10 цифр после +7 → «707 123 45 67» */
function formatLocal(digits: string) {
  const d = digits.slice(0, 10);
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6, 8), d.slice(8, 10)].filter(Boolean).join(' ');
}

export default function Phone() {
  const c = useColors();
  const { mode } = useLocalSearchParams<{ mode?: 'login' }>();
  const login = mode === 'login';
  const { state, dispatch } = useAppStore();
  const [digits, setDigits] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const isClient = state.signup.role === 'client';

  async function send() {
    setSending(true);
    setError(null);
    try {
      const r = await smsStart(`+7${digits}`);
      router.push({ pathname: '/code', params: { phone: r.phone, mode: login ? 'login' : 'signup', delivery: r.delivery } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось отправить код. Попробуйте ещё раз.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen
      footer={
        <>
          <Txt variant="caption" tone="muted" center style={{ fontSize: 12, lineHeight: 16 }}>
            Номер нужен только для входа по коду.
          </Txt>
          <Button title={sending ? 'Отправляем…' : 'Получить код'} block disabled={digits.length !== 10 || sending} onPress={send} />
        </>
      }>
      <View style={styles.head}>
        <RoundButton icon="back" label="Назад" onPress={() => router.back()} />
        {!login && (
          <>
            <View style={[styles.progress, { backgroundColor: c.track }]}>
              <View style={[styles.progressFill, { backgroundColor: c.ink }]} />
            </View>
            <Txt variant="caption" tone="muted">3 из 4</Txt>
          </>
        )}
      </View>
      <View style={{ gap: space[2] }}>
        <Txt variant="display">{login ? 'Вход' : 'Ваш номер телефона'}</Txt>
        <Txt tone="muted">{login ? 'Введите номер, с которым регистрировались.' : 'По нему вы будете входить в приложение.'}</Txt>
      </View>
      <TextField
        label="Номер телефона"
        prefix="+7"
        big
        value={formatLocal(digits)}
        onChangeText={(v) => {
          let d = v.replace(/\D/g, '');
          if (d.length === 11 && (d.startsWith('8') || d.startsWith('7'))) d = d.slice(1); // вставили с 8 или 7
          setDigits(d.slice(0, 10));
          setError(null);
        }}
        placeholder="707 123 45 67"
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        autoFocus
        error={error}
      />
      {!login && isClient && (
        <TextField
          label="Код тренера или нутрициолога — если дали"
          value={state.signup.inviteCode}
          onChangeText={(v) => dispatch({ type: 'setSignup', patch: { inviteCode: v.replace(/\s/g, '').toLowerCase() } })}
          placeholder="Например, k7m2px"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={16}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space[4], minHeight: 44 },
  progress: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { width: '75%', height: 4, borderRadius: 2 },
});

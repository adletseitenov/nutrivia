import { router } from 'expo-router';
import { useState } from 'react';

import { ApiError, joinCoach } from '@/api/client';
import { Button } from '@/components/button';
import { RoundButton } from '@/components/round-button';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { Txt } from '@/components/txt';
import { useAppStore } from '@/store/app-store';

/** Ввод кода тренера или нутрициолога после регистрации (из профиля). */
export default function Join() {
  const { dispatch } = useAppStore();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      dispatch({ type: 'setMe', me: await joinCoach(code) });
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось. Попробуйте ещё раз.');
      setBusy(false);
    }
  }

  return (
    <Screen footer={<Button title={busy ? 'Проверяем…' : 'Подключиться'} block disabled={code.length < 4 || busy} onPress={submit} />}>
      <RoundButton icon="back" label="Назад" onPress={() => router.back()} />
      <Txt variant="display">Код тренера или нутрициолога</Txt>
      <Txt tone="muted">После подключения специалист увидит ваши калории и серию. Ваше имя и телефон он не видит.</Txt>
      <TextField
        label="Код"
        value={code}
        onChangeText={(v) => { setCode(v.replace(/\s/g, '').toLowerCase()); setError(null); }}
        placeholder="Например, k7m2px"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        maxLength={16}
        error={error}
      />
    </Screen>
  );
}

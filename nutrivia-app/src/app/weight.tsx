import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { addWeight, ApiError, bodyFromMe } from '@/api/client';
import { Button } from '@/components/button';
import { RoundButton } from '@/components/round-button';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { Txt } from '@/components/txt';
import { fmt, kgText } from '@/engine/engine';
import { refreshToday, useAppStore } from '@/store/app-store';
import { space } from '@/theme/tokens';
import { t } from '@/lib/i18n';

/** Записать вес. Раз в день: повтор в тот же день заменяет прежнее значение. Норма пересчитывается на сервере. */
export default function WeightScreen() {
  const { state, dispatch } = useAppStore();
  const prev = bodyFromMe(state.me)?.weightKg;
  const [value, setValue] = useState(prev ? kgText(prev) : '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const kg = Number(value.replace(',', '.'));
  const valid = kg >= 35 && kg <= 300;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await addWeight(Math.round(kg * 10) / 10);
      dispatch({ type: 'setMe', me: r.me });
      refreshToday(dispatch);
      if (router.canGoBack()) router.back();
      else router.replace('/progress');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось сохранить. Попробуйте ещё раз.');
      setSaving(false);
    }
  }

  const kcal = state.me?.targets?.kcal;
  return (
    <Screen footer={<Button title={saving ? 'Сохраняем…' : 'Сохранить'} block disabled={!valid || saving} onPress={save} />}>
      <RoundButton icon="back" label={t('Назад')} onPress={() => router.back()} />
      <View style={{ gap: space[2] }}>
        <Txt variant="display">{t('Вес сегодня')}</Txt>
        <Txt tone="muted">
          Лучше утром, до еды. По весу уточним ориентир{kcal ? ` — сейчас ${fmt(kcal)} ккал` : ''}.
        </Txt>
      </View>
      <TextField
        label={t('Вес, кг')}
        big
        value={value}
        onChangeText={(v) => {
          setValue(v.replace(/[^\d.,]/g, '').slice(0, 5));
          setError(null);
        }}
        placeholder="70,5"
        keyboardType="decimal-pad"
        autoFocus
        error={error ?? (value.length >= 2 && !valid ? 'От 35 до 300 кг.' : null)}
      />
    </Screen>
  );
}

import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ApiError, bodyFromMe, patchBody } from '@/api/client';
import { Button } from '@/components/button';
import { RoundButton } from '@/components/round-button';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { Txt } from '@/components/txt';
import { fmt } from '@/engine/engine';
import { ACTIVITIES, personalTargets, type Activity, type Body, type Sex } from '@/engine/targets';
import { refreshToday, useAppStore } from '@/store/app-store';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';
import { t } from '@/lib/i18n';

const YEAR = new Date().getFullYear();

const digits = (v: string, max: number) => v.replace(/[^\d]/g, '').slice(0, max);

/** Пол, возраст, рост, вес и активность → личный ориентир калорий и белка. В онбординге и из профиля. */
export default function BodyScreen() {
  const c = useColors();
  const { state, dispatch } = useAppStore();
  const editing = state.onboarded;
  const start = (editing ? bodyFromMe(state.me) : state.signup.body) ?? null;
  const [sex, setSex] = useState<Sex | null>(start?.sex ?? null);
  const [year, setYear] = useState(start ? String(start.birthYear) : '');
  const [height, setHeight] = useState(start ? String(start.heightCm) : '');
  const [weight, setWeight] = useState(start ? String(start.weightKg) : '');
  const [activity, setActivity] = useState<Activity | null>(start?.activity ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const y = Number(year), h = Number(height), w = Number(weight.replace(',', '.'));
  const problems = {
    year: year.length === 4 && (YEAR - y < 18 ? 'Nutrivia — только для взрослых, от 18 лет.' : y < 1920 ? 'Проверьте год.' : null),
    height: height.length >= 3 && (h < 120 || h > 230) ? 'Рост в сантиметрах, от 120 до 230.' : null,
    weight: weight.length >= 2 && (w < 35 || w > 300) ? 'Вес в килограммах, от 35 до 300.' : null,
  };
  const body: Body | null =
    sex && activity && year.length === 4 && !problems.year && h >= 120 && h <= 230 && w >= 35 && w <= 300
      ? { sex, birthYear: y, heightCm: h, weightKg: w, activity }
      : null;
  const goal = state.goal === 'coach' ? null : state.goal;
  const preview = body ? personalTargets(body, goal) : null;
  const setByPro = editing && state.me?.targets?.set_by_pro;

  async function next() {
    if (!body) return;
    if (!editing) {
      dispatch({ type: 'setSignup', patch: { body } }); // уйдёт на сервер сразу после входа
      return router.push('/phone');
    }
    setSaving(true);
    setError(null);
    try {
      dispatch({ type: 'setMe', me: await patchBody(body) });
      refreshToday(dispatch);
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось сохранить. Попробуйте ещё раз.');
      setSaving(false);
    }
  }

  return (
    <Screen
      footer={
        <>
          {preview && (
            <View style={[styles.target, { backgroundColor: c.surface }]}>
              <Txt variant="caption" tone="muted">{t('Ориентир на день')}</Txt>
              <Txt variant="headline" style={{ fontSize: 15 }} numberOfLines={1}>
                {setByPro ? 'задал нутрициолог' : `${fmt(preview.kcal)} ккал · белок ${preview.protein} г`}
              </Txt>
            </View>
          )}
          {error && <Txt variant="caption" tone="warning">{error}</Txt>}
          <Button title={saving ? 'Сохраняем…' : editing ? 'Сохранить' : 'Продолжить'} block disabled={!body || saving} onPress={next} />
        </>
      }>
      <View style={styles.head}>
        <RoundButton icon="back" label={t('Назад')} onPress={() => router.back()} />
        {!editing && (
          <>
            <View style={[styles.progress, { backgroundColor: c.track }]}>
              <View style={[styles.progressFill, { backgroundColor: c.ink }]} />
            </View>
            <Txt variant="caption" tone="muted">3 из 5</Txt>
          </>
        )}
      </View>

      <View style={{ gap: space[2] }}>
        <Txt variant="display">{t('Немного о вас')}</Txt>
        <Txt tone="muted">{t('Посчитаем личный ориентир калорий и белка. Видите его только вы и ваш специалист.')}</Txt>
      </View>

      <View style={styles.row} accessibilityRole="radiogroup">
        {(['f', 'm'] as const).map((s) => {
          const on = sex === s;
          return (
            <Pressable
              key={s}
              accessibilityRole="radio"
              accessibilityLabel={t(s === 'f' ? 'Женщина' : 'Мужчина')}
              accessibilityState={{ checked: on }}
              onPress={() => {
                Haptics.selectionAsync();
                setSex(s);
              }}
              style={[styles.chip, { backgroundColor: on ? c.ink : c.surface }]}>
              <Txt variant="headline" style={{ color: on ? c.onInk : c.ink }}>{t(s === 'f' ? 'Женщина' : 'Мужчина')}</Txt>
            </Pressable>
          );
        })}
      </View>

      <TextField label={t('Год рождения')} value={year} onChangeText={(v) => setYear(digits(v, 4))} placeholder="1995"
        keyboardType="number-pad" maxLength={4} error={problems.year || null} />
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <TextField label={t('Рост, см')} value={height} onChangeText={(v) => setHeight(digits(v, 3))} placeholder="165"
            keyboardType="number-pad" maxLength={3} error={problems.height} />
        </View>
        <View style={{ flex: 1 }}>
          <TextField label={t('Вес, кг')} value={weight} onChangeText={(v) => setWeight(v.replace(/[^\d.,]/g, '').slice(0, 5))}
            placeholder="70" keyboardType="decimal-pad" maxLength={5} error={problems.weight} />
        </View>
      </View>

      <View style={{ gap: space[2] }} accessibilityRole="radiogroup">
        <Txt variant="caption" tone="muted">{t('Активность')}</Txt>
        {ACTIVITIES.map((a) => {
          const on = activity === a.id;
          return (
            <Pressable
              key={a.id}
              accessibilityRole="radio"
              accessibilityLabel={`${t(a.title)}: ${t(a.sub)}`}
              accessibilityState={{ checked: on }}
              onPress={() => {
                Haptics.selectionAsync();
                setActivity(a.id);
              }}
              style={[styles.option, { backgroundColor: on ? c.ink : c.surface }]}>
              <Txt variant="headline" style={{ color: on ? c.onInk : c.ink, fontSize: 15 }}>{t(a.title)}</Txt>
              <Txt variant="caption" style={{ color: on ? c.onInk : c.muted, opacity: on ? 0.72 : 1 }}>{t(a.sub)}</Txt>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space[4], minHeight: 44 },
  progress: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { width: '60%', height: 4, borderRadius: 2 },
  row: { flexDirection: 'row', gap: space[3] },
  chip: { flex: 1, minHeight: 52, borderRadius: radius.m, alignItems: 'center', justifyContent: 'center' },
  option: { borderRadius: radius.m, paddingHorizontal: space[4], paddingVertical: 12, gap: 2 },
  target: { borderRadius: radius.m, padding: space[4], flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space[3] },
});

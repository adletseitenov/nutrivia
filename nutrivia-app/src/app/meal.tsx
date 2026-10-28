import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, getMeal, type ServerMeal } from '@/api/client';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { MealPhoto } from '@/components/meal-photo';
import { RoundButton } from '@/components/round-button';
import { reviewedLabel, StatusPill } from '@/components/status-pill';
import { Txt } from '@/components/txt';
import { fmt, getDish, portionText } from '@/engine/engine';
import { itemsFromServer, mealNutrients } from '@/store/app-store';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

const ROLE_LABEL = { trainer: 'ваш тренер', nutritionist: 'ваш нутрициолог', operator: 'команда Nutrivia' } as const;

function hhmm(ts?: number | null) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Приём пищи клиента: фото, блюда, статус проверки и комментарий проверяющего. */
export default function Meal() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [meal, setMeal] = useState<ServerMeal | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Свежий статус при открытии; пока разбор ждёт проверки — раз в 15 секунд
  useFocusEffect(
    useCallback(() => {
      const load = () =>
        getMeal(Number(id)).then(
          (m) => { setMeal(m); setError(null); },
          (e) => setError(e instanceof ApiError ? e.message : 'Не получилось загрузить приём пищи.'),
        );
      load();
      const timer = setInterval(load, 15000);
      return () => clearInterval(timer);
    }, [id]),
  );

  if (!meal) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg, paddingTop: insets.top }]}>
        {error ? <Txt tone="warning" center>{error}</Txt> : <ActivityIndicator color={c.ink} />}
        <Button title="Назад" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  const items = itemsFromServer(meal.items);
  const total = mealNutrients(items);
  const reviewed = meal.status === 'reviewed';
  const adjusted = meal.items.some((i) => i.ai_grams && Math.abs(i.ai_grams - i.grams) >= 1);

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ paddingBottom: insets.bottom + space[6] }}>
      <View>
        <MealPhoto uri={meal.has_photo ? `server:${meal.id}` : null} width={width} height={320} />
        <View style={[styles.photoBar, { top: insets.top + space[2] }]}>
          <RoundButton icon="back" label="Назад" onPress={() => router.back()} />
          <StatusPill status={reviewed ? 'reviewed' : 'draft'} label={reviewed ? reviewedLabel(meal.reviewer?.role) : undefined} />
        </View>
      </View>

      <View style={styles.body}>
        <View style={{ gap: 2 }}>
          <Txt variant="caption" tone="muted">Приём пищи · {hhmm(meal.received_at)}</Txt>
          <Txt variant="numberXl">
            {fmt(total.kcal)}<Txt variant="headline" tone="muted"> ккал</Txt>
          </Txt>
          <View style={styles.macros}>
            {([['Белки', total.protein, c.macroProtein], ['Углеводы', total.carbs, c.macroCarbs], ['Жиры', total.fat, c.macroFat]] as const).map(
              ([name, v, color]) => (
                <View key={name} style={styles.macro}>
                  <View style={[styles.dot, { backgroundColor: color }]} />
                  <Txt variant="caption" tone="muted">{name} {fmt(v)} г</Txt>
                </View>
              ),
            )}
          </View>
        </View>

        <View style={{ gap: space[2] }}>
          {meal.items.map((it, i) => {
            const dish = it.dish_id ? getDish(it.dish_id) : null;
            const changed = it.ai_grams && Math.abs(it.ai_grams - it.grams) >= 1;
            return (
              <View key={`${it.dish_id ?? it.raw_name}-${i}`} style={[styles.dish, { backgroundColor: c.surface }]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="headline">{it.name}</Txt>
                  <Txt variant="caption" tone="muted">
                    {dish ? portionText(dish, it.grams) : `≈${fmt(it.grams)} г`}
                    {it.kcal !== null ? ` · ${fmt(it.kcal)} ккал` : ''}
                  </Txt>
                  {changed && (
                    <Txt variant="caption" tone="green">по фото было ≈{fmt(it.ai_grams ?? 0)} г — поправлено при проверке</Txt>
                  )}
                  {!dish && <Txt variant="caption" tone="warning">Нет в нашей базе — нутрициолог уточнит</Txt>}
                </View>
              </View>
            );
          })}
        </View>

        {reviewed ? (
          <View style={[styles.comment, { backgroundColor: c.surface }]}>
            <View style={styles.reviewer}>
              <View style={[styles.avatar, { backgroundColor: c.ink }]}>
                <Txt variant="label" style={{ color: c.onInk }}>{(meal.reviewer?.name ?? 'Н').slice(0, 1).toUpperCase()}</Txt>
              </View>
              <View style={{ flex: 1 }}>
                <Txt variant="headline" style={{ fontSize: 15, lineHeight: 20 }}>{meal.reviewer?.name ?? 'Нутрициолог Nutrivia'}</Txt>
                <Txt variant="caption" tone="muted">
                  {ROLE_LABEL[meal.reviewer?.role ?? 'operator']} · проверено в {hhmm(meal.reviewed_at)}
                </Txt>
              </View>
              <Icon name="check" size={20} color={c.greenText} strokeWidth={2.2} />
            </View>
            <Txt style={{ fontSize: 15, lineHeight: 22, color: meal.comment ? c.ink : c.muted }}>
              {meal.comment ?? (adjusted ? 'Порции поправлены, без комментария.' : 'Разбор подтверждён без замечаний.')}
            </Txt>
          </View>
        ) : (
          <View style={[styles.waiting, { backgroundColor: c.greenTint }]}>
            <Icon name="clock" size={20} color={c.greenText} />
            <Txt variant="caption" style={{ flex: 1, fontSize: 14, lineHeight: 20 }}>
              Это оценка по фото. Нутрициолог проверит разбор в течение 15 минут — комментарий появится здесь.
            </Txt>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[4], padding: space[5] },
  photoBar: { position: 'absolute', left: space[5], right: space[5], flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  body: { paddingHorizontal: space[5], paddingTop: space[5], gap: space[5] },
  macros: { flexDirection: 'row', gap: space[4], flexWrap: 'wrap', marginTop: space[1] },
  macro: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dish: { borderRadius: radius.m, paddingVertical: space[3], paddingHorizontal: space[4] },
  comment: { borderRadius: radius.m, padding: space[4], gap: space[3] },
  reviewer: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  waiting: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start', borderRadius: radius.m, paddingVertical: space[3], paddingHorizontal: space[4] },
});

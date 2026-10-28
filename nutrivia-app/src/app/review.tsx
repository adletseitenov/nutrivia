import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, confirmMeal, putItems, uploadMeal, type ServerMeal } from '@/api/client';
import { AddDishSheet } from '@/components/add-dish-sheet';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { MealPhoto } from '@/components/meal-photo';
import { RoundButton } from '@/components/round-button';
import { StatusPill } from '@/components/status-pill';
import { Txt } from '@/components/txt';
import { compute, fmt, getDish, portionCount, portionText } from '@/engine/engine';
import { itemsFromServer, mealNutrients, refreshToday, useAppStore, type MealItem } from '@/store/app-store';
import { font, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'not_food' }
  | { kind: 'ready'; meal: ServerMeal };

/** Разбор фото: сервер присылает черновик модели, порции правятся шагом ½, пересчёт — Engine. */
export default function Review() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { photo } = useLocalSearchParams<{ photo?: string }>();
  const { dispatch } = useAppStore();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [items, setItems] = useState<MealItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);

  const [attempt, setAttempt] = useState(0);

  // Загрузка фото на сервер; повтор — через attempt
  useEffect(() => {
    let alive = true;
    uploadMeal(photo ?? 'demo:plov').then(
      (meal) => {
        if (!alive) return;
        if (meal.status === 'not_food') return setPhase({ kind: 'not_food' });
        setItems(itemsFromServer(meal.items));
        setPhase({ kind: 'ready', meal });
      },
      (e) => {
        if (alive) setPhase({ kind: 'error', message: e instanceof ApiError ? e.message : 'Что-то пошло не так. Попробуйте ещё раз.' });
      },
    );
    return () => {
      alive = false;
    };
  }, [photo, attempt]);

  function analyze() {
    setPhase({ kind: 'loading' });
    setAttempt((n) => n + 1);
  }

  const total = useMemo(() => mealNutrients(items), [items]);
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  function step(i: number, dir: 1 | -1) {
    const id = items[i].dishId;
    if (!id) return;
    Haptics.selectionAsync();
    const unit = getDish(id).unitGrams || 100;
    const units = Math.min(5, Math.max(0.5, Math.round((items[i].grams / unit) * 2) / 2 + dir * 0.5));
    setItems(items.map((it, j) => (j === i ? { ...it, grams: Math.round(units * unit) } : it)));
  }

  async function confirm() {
    if (phase.kind !== 'ready') return;
    setSaving(true);
    try {
      const id = phase.meal.id;
      const edited = items.length !== phase.meal.items.length || items.some((it, i) => it.grams !== phase.meal.items[i]?.grams);
      const inBase = items.filter((it): it is MealItem & { dishId: string } => !!it.dishId);
      if (edited && inBase.length) await putItems(id, inBase.map((it) => ({ dish_id: it.dishId, grams: it.grams })));
      const saved = await confirmMeal(id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      dispatch({
        type: 'addMeal',
        meal: {
          id: `s-${id}`,
          serverId: id,
          title: items.map((it, j) => (j ? (it.name ?? '').charAt(0).toLowerCase() + (it.name ?? '').slice(1) : it.name)).join(', '),
          time,
          photo: photo ?? null,
          status: saved.status === 'reviewed' ? 'reviewed' : 'draft',
          items: itemsFromServer(saved.items),
        },
      });
      refreshToday(dispatch);
      router.dismissTo('/today');
    } catch (e) {
      setSaving(false);
      setPhase({ kind: 'error', message: e instanceof ApiError ? e.message : 'Не получилось сохранить. Попробуйте ещё раз.' });
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <MealPhoto uri={photo} width={width} height={330} />
      <View style={[styles.photoBar, { top: insets.top + space[2] }]}>
        <RoundButton icon="back" label="Назад" onPress={() => router.back()} />
        {phase.kind === 'ready' && <StatusPill status={phase.meal.status === 'reviewed' ? 'reviewed' : 'draft'} />}
      </View>

      <View style={[styles.sheet, { backgroundColor: c.bg }]}>
        {phase.kind === 'loading' && (
          <View style={styles.center}>
            <ActivityIndicator color={c.ink} />
            <Txt variant="headline">Разбираем фото…</Txt>
            <Txt variant="caption" tone="muted" center>Обычно это занимает 10–20 секунд</Txt>
          </View>
        )}

        {phase.kind === 'error' && (
          <View style={styles.center}>
            <Txt variant="headline" center>{phase.message}</Txt>
            <View style={{ flexDirection: 'row', gap: space[3] }}>
              <Button title="Закрыть" variant="secondary" onPress={() => router.back()} />
              <Button title="Повторить" onPress={analyze} />
            </View>
          </View>
        )}

        {phase.kind === 'not_food' && (
          <View style={styles.center}>
            <Txt variant="title" center>Не вижу еды на фото</Txt>
            <Txt tone="muted" center>Снимите тарелку целиком, сверху и при хорошем свете.</Txt>
            <Button title="Переснять" onPress={() => router.replace('/camera')} />
          </View>
        )}

        {phase.kind === 'ready' && (
          <>
            <ScrollView contentContainerStyle={{ gap: 18, paddingBottom: space[4] }} showsVerticalScrollIndicator={false}>
              <View style={styles.totals}>
                <View>
                  <Txt variant="caption" tone="muted">Приём пищи · {time}</Txt>
                  <Txt variant="numberXl">
                    {fmt(total.kcal)}<Txt variant="headline" tone="muted"> ккал</Txt>
                  </Txt>
                </View>
                <View style={{ gap: 4, alignItems: 'flex-end' }}>
                  {([['Белки', total.protein, c.macroProtein], ['Углеводы', total.carbs, c.macroCarbs], ['Жиры', total.fat, c.macroFat]] as const).map(
                    ([name, v, color]) => (
                      <View key={name} style={styles.macroRow}>
                        <View style={[styles.dot, { backgroundColor: color }]} />
                        <Txt variant="caption" tone="muted">{name} {fmt(v)} г</Txt>
                      </View>
                    ),
                  )}
                </View>
              </View>

              <View style={{ gap: space[2] }}>
                {items.map((it, i) => {
                  if (!it.dishId) {
                    return (
                      <View key={`x-${i}`} style={[styles.dish, { backgroundColor: c.surface }]}>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Txt variant="headline">{it.name}</Txt>
                          <Txt variant="caption" tone="warning">Нет в нашей базе — нутрициолог уточнит · ≈{fmt(it.grams)} г</Txt>
                        </View>
                      </View>
                    );
                  }
                  const dish = getDish(it.dishId);
                  return (
                    <View key={it.dishId} style={[styles.dish, { backgroundColor: c.surface }]}>
                      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                        <Txt variant="headline">{it.name ?? dish.nameRu}</Txt>
                        <Txt variant="caption" tone="muted">
                          {portionText(dish, it.grams)} · {fmt(compute(dish, it.grams).kcal)} ккал
                        </Txt>
                      </View>
                      <View style={[styles.stepper, { backgroundColor: c.bg }]}>
                        <Pressable accessibilityRole="button" accessibilityLabel="Меньше" onPress={() => step(i, -1)} style={styles.stepBtn}>
                          <Icon name="minus" size={18} color={c.ink} strokeWidth={2} />
                        </Pressable>
                        <Txt style={{ fontFamily: font.bold, fontSize: 15, minWidth: 28, textAlign: 'center' }}>
                          {portionCount(it.grams / (dish.unitGrams || 100))}
                        </Txt>
                        <Pressable accessibilityRole="button" accessibilityLabel="Больше" onPress={() => step(i, 1)} style={styles.stepBtn}>
                          <Icon name="plus" size={18} color={c.ink} strokeWidth={2} />
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
                <Pressable accessibilityRole="button" onPress={() => setAdding(true)} style={styles.add}>
                  <Icon name="plus" size={18} color={c.greenText} strokeWidth={2} />
                  <Txt style={{ fontFamily: font.semibold, fontSize: 15, color: c.greenText }}>Добавить блюдо</Txt>
                </Pressable>
              </View>

              <View style={[styles.note, { backgroundColor: c.greenTint }]}>
                <Icon name="clock" size={20} color={c.greenText} />
                <Txt variant="caption" style={{ flex: 1, fontSize: 14, lineHeight: 20 }}>
                  {phase.meal.night
                    ? 'Это оценка по фото. Сейчас ночь — нутрициолог проверит разбор утром после 9:00.'
                    : 'Это оценка по фото. Нутрициолог проверит разбор в течение 15 минут.'}
                </Txt>
              </View>
            </ScrollView>
            <View style={[styles.actions, { paddingBottom: insets.bottom + space[3] }]}>
              <Button title="Переснять" variant="secondary" style={{ flex: 1 }} onPress={() => router.replace('/camera')} />
              <Button title={saving ? 'Сохраняем…' : 'Верно'} variant="accent" style={{ flex: 1 }} disabled={saving} onPress={confirm} />
            </View>
          </>
        )}
      </View>
      <AddDishSheet
        visible={adding}
        onClose={() => setAdding(false)}
        onPick={(d) => {
          Haptics.selectionAsync();
          if (!items.some((it) => it.dishId === d.id)) {
            setItems([...items, { dishId: d.id, grams: d.unit_grams || 100, name: d.name }]);
          }
          setAdding(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  photoBar: { position: 'absolute', left: space[5], right: space[5], flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheet: { flex: 1, marginTop: -34, borderTopLeftRadius: radius.l, borderTopRightRadius: radius.l, paddingHorizontal: space[5], paddingTop: space[5] },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[3], paddingBottom: space[6] },
  totals: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  macroRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dish: { borderRadius: radius.m, paddingVertical: space[3], paddingLeft: space[4], paddingRight: space[3], flexDirection: 'row', alignItems: 'center', gap: space[3] },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.full, padding: 4 },
  stepBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  add: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: 10, paddingHorizontal: 4, minHeight: 44 },
  note: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start', borderRadius: radius.m, paddingVertical: space[3], paddingHorizontal: space[4] },
  actions: { flexDirection: 'row', gap: space[3], paddingTop: space[3] },
});

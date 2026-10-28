import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, getProMeal, proComment, proSend, putProItems, type DishHit, type ProMeal } from '@/api/client';
import { AddDishSheet } from '@/components/add-dish-sheet';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { MealPhoto } from '@/components/meal-photo';
import { RoundButton } from '@/components/round-button';
import { StatusPill } from '@/components/status-pill';
import { Txt } from '@/components/txt';
import { compute, fmt, getDish, portionCount, portionText } from '@/engine/engine';
import { GOALS, itemsFromServer, mealNutrients, type MealItem } from '@/store/app-store';
import { font, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

/** Быстрые фразы для комментария. Без «дефицит» и «диагноз» — как во всех текстах Nutrivia. */
const QUICK = ['Хороший выбор!', 'Добавьте белок на ужин', 'Больше овощей к основному блюду', 'Порцию можно чуть меньше'];

function ago(ts?: number) {
  if (!ts) return '';
  const min = Math.max(0, Math.round((Date.now() / 1000 - ts) / 60));
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  return `${Math.floor(min / 60)} ч ${min % 60} мин назад`;
}

function goalTitle(goal?: string | null) {
  const id = goal === 'coach_plan' ? 'coach' : goal;
  return GOALS.find((g) => g.id === id)?.title ?? 'цель не указана';
}

/** Проверка разбора тренером или нутрициологом: порции, замена блюда, комментарий, «Отправить». */
export default function ProReview() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const mealId = Number(id);
  const [meal, setMeal] = useState<ProMeal | null>(null);
  const [items, setItems] = useState<MealItem[]>([]);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edited, setEdited] = useState(false);
  // какое блюдо заменяем из базы (null — добавляем новое, undefined — лист закрыт)
  const [picking, setPicking] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    getProMeal(mealId).then(
      (m) => {
        setMeal(m);
        setItems(itemsFromServer(m.items));
        setComment(m.comment ?? '');
      },
      (e) => setError(e instanceof ApiError ? e.message : 'Не получилось загрузить разбор.'),
    );
  }, [mealId]);

  const total = useMemo(() => mealNutrients(items), [items]);
  const hasUnmatched = items.some((it) => !it.dishId);

  function change(next: MealItem[]) {
    setItems(next);
    setEdited(true);
  }

  function step(i: number, dir: 1 | -1) {
    const dishId = items[i].dishId;
    if (!dishId) return;
    Haptics.selectionAsync();
    const unit = getDish(dishId).unitGrams || 100;
    const units = Math.min(5, Math.max(0.5, Math.round((items[i].grams / unit) * 2) / 2 + dir * 0.5));
    change(items.map((it, j) => (j === i ? { ...it, grams: Math.round(units * unit) } : it)));
  }

  function pick(d: DishHit) {
    const fresh: MealItem = { dishId: d.id, grams: d.unit_grams || 100, name: d.name };
    if (typeof picking === 'number') {
      // замена: граммы с фото сохраняем, если они были
      const was = items[picking];
      change(items.map((it, j) => (j === picking ? { ...fresh, grams: was.grams || fresh.grams } : it)));
    } else if (!items.some((it) => it.dishId === d.id)) {
      change([...items, fresh]);
    }
    setPicking(undefined);
  }

  async function send() {
    if (!meal) return;
    setBusy(true);
    setError(null);
    try {
      if (edited) {
        const base = items.filter((it): it is MealItem & { dishId: string } => !!it.dishId);
        if (!base.length) throw new ApiError(0, 'В разборе должно остаться хотя бы одно блюдо.');
        await putProItems(meal.id, base.map((it) => ({ dish_id: it.dishId, grams: it.grams })));
      }
      if (comment.trim() && comment.trim() !== (meal.comment ?? '')) await proComment(meal.id, comment.trim());
      await proSend(meal.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(e instanceof ApiError ? e.message : 'Не получилось отправить. Попробуйте ещё раз.');
      setBusy(false);
    }
  }

  if (!meal) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg, paddingTop: insets.top + space[3] }]}>
        {error ? <Txt tone="warning" center>{error}</Txt> : <ActivityIndicator color={c.ink} />}
        <Button title="Назад" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ paddingBottom: space[6] }} keyboardShouldPersistTaps="handled">
        <View>
          <MealPhoto uri={meal.has_photo ? `pro:${meal.id}` : null} width={width} height={300} />
          <View style={[styles.photoBar, { top: insets.top + space[2] }]}>
            <RoundButton icon="back" label="Назад" onPress={() => router.back()} />
            <StatusPill status={meal.status === 'reviewed' ? 'reviewed' : 'draft'} label={meal.status === 'reviewed' ? 'Отправлено' : 'Ждёт проверки'} />
          </View>
        </View>

        <View style={styles.body}>
          <View style={{ gap: 2 }}>
            <Txt variant="title">{meal.student}</Txt>
            <Txt variant="caption" tone="muted">
              {ago(meal.received_at)} · цель: {goalTitle(meal.student_goal).toLowerCase()}
              {meal.student_restrictions ? ` · ограничения: ${meal.student_restrictions}` : ''}
            </Txt>
          </View>

          <View style={styles.totals}>
            <Txt variant="numberXl">
              {fmt(total.kcal)}<Txt variant="headline" tone="muted"> ккал</Txt>
            </Txt>
            <Txt variant="caption" tone="muted">Б {fmt(total.protein)} · У {fmt(total.carbs)} · Ж {fmt(total.fat)} г</Txt>
          </View>

          <View style={{ gap: space[2] }}>
            {items.map((it, i) => {
              if (!it.dishId) {
                return (
                  <View key={`x-${i}`} style={[styles.dish, { backgroundColor: c.surface, borderColor: c.warning, borderWidth: 1.5 }]}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt variant="headline">{it.name}</Txt>
                      <Txt variant="caption" tone="warning">Нет в базе · ≈{fmt(it.grams)} г — замените блюдом из базы</Txt>
                    </View>
                    <Button title="Заменить" size="s" variant="secondary" style={{ backgroundColor: c.bg }} onPress={() => setPicking(i)} />
                    <Pressable accessibilityRole="button" accessibilityLabel="Убрать блюдо" onPress={() => change(items.filter((_, j) => j !== i))} style={styles.remove}>
                      <Icon name="close" size={18} color={c.muted} />
                    </Pressable>
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
                  <Pressable accessibilityRole="button" accessibilityLabel="Убрать блюдо" onPress={() => change(items.filter((_, j) => j !== i))} style={styles.remove}>
                    <Icon name="close" size={18} color={c.muted} />
                  </Pressable>
                </View>
              );
            })}
            <Pressable accessibilityRole="button" onPress={() => setPicking(null)} style={styles.add}>
              <Icon name="plus" size={18} color={c.greenText} strokeWidth={2} />
              <Txt style={{ fontFamily: font.semibold, fontSize: 15, color: c.greenText }}>Добавить блюдо</Txt>
            </Pressable>
          </View>

          <View style={{ gap: space[2] }}>
            <Txt variant="headline">Комментарий ученику</Txt>
            <View style={styles.quick}>
              {QUICK.map((q) => (
                <Pressable
                  key={q}
                  accessibilityRole="button"
                  onPress={() => setComment((t) => (t.trim() ? `${t.trim()} ${q}` : q))}
                  style={[styles.chip, { backgroundColor: c.surface }]}>
                  <Txt variant="caption">{q}</Txt>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder="Необязательно. Ученик увидит его в разборе и в итоге недели."
              placeholderTextColor={c.muted}
              multiline
              maxLength={1000}
              accessibilityLabel="Комментарий ученику"
              style={[styles.comment, { backgroundColor: c.surface, color: c.ink }]}
            />
          </View>

          {error && <Txt tone="warning">{error}</Txt>}
          <Button
            title={busy ? 'Отправляем…' : 'Отправить ученику'}
            variant="accent"
            block
            disabled={busy || meal.status === 'reviewed' || hasUnmatched || items.length === 0}
            onPress={send}
          />
          {hasUnmatched && <Txt variant="caption" tone="muted" center>Сначала замените или уберите блюдо не из базы.</Txt>}
        </View>
      </ScrollView>

      <AddDishSheet visible={picking !== undefined} onClose={() => setPicking(undefined)} onPick={pick} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[4], padding: space[5] },
  photoBar: { position: 'absolute', left: space[5], right: space[5], flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  body: { paddingHorizontal: space[5], paddingTop: space[5], gap: space[5] },
  totals: { gap: 2 },
  dish: { borderRadius: radius.m, paddingVertical: space[3], paddingLeft: space[4], paddingRight: space[2], flexDirection: 'row', alignItems: 'center', gap: space[2] },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.full, padding: 4 },
  stepBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  remove: { width: 32, height: 44, alignItems: 'center', justifyContent: 'center' },
  add: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: 10, paddingHorizontal: 4, minHeight: 44 },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { borderRadius: radius.full, paddingHorizontal: space[3], paddingVertical: space[2] },
  comment: { borderRadius: radius.m, padding: space[4], minHeight: 96, fontFamily: font.regular, fontSize: 16, lineHeight: 22, textAlignVertical: 'top' },
});

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { getToday, type ServerToday } from '@/api/client';
import { Button } from '@/components/button';
import { MascotSlot } from '@/components/mascot-slot';
import { MealCard } from '@/components/meal-card';
import { CalorieRing, MacroCard } from '@/components/rings';
import { Screen } from '@/components/screen';
import { Txt } from '@/components/txt';
import { add, fmt, ZERO } from '@/engine/engine';
import { dayLabel, dayOfMonth, daysWord, todayTitle, WEEKDAYS_SHORT } from '@/lib/dates';
import { mealFromServer, mealNutrients, refreshToday, useAppStore, useTargets, useToday } from '@/store/app-store';
import { font, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';
import { t } from '@/lib/i18n';

export default function Today() {
  const c = useColors();
  const { state, dispatch } = useAppStore();
  const tg = useTargets();
  const eaten = useToday();
  const streak = state.progress?.streak;
  const week = state.progress?.week.days ?? [];
  // Выбранный прошлый день из полосы; null — сегодня (он живёт в сторе и обновляется сам)
  const [picked, setPicked] = useState<string | null>(null);
  const [past, setPast] = useState<ServerToday | null>(null);

  // Свежий день с сервера при каждом открытии вкладки (статусы разборов, правки нутрициолога)
  useFocusEffect(
    useCallback(() => {
      refreshToday(dispatch);
      if (picked) getToday(picked).then(setPast, () => {});
    }, [dispatch, picked]),
  );

  function pickDay(date: string, isToday: boolean) {
    setPast(null);
    setPicked(isToday ? null : date);
    if (!isToday) getToday(date).then(setPast, () => {});
  }

  const meals = picked ? (past?.meals ?? []).map(mealFromServer) : state.meals;
  const dayEaten = picked ? meals.reduce((acc, m) => add(acc, mealNutrients(m.items)), ZERO) : eaten;
  const loaded = picked ? !!past : state.loaded;
  const label = picked ? dayLabel(picked) : null;
  const addManual = () => router.push(picked ? { pathname: '/manual', params: { date: picked, label } } : '/manual');

  return (
    <Screen tabs>
      <View style={styles.head}>
        <View>
          <Txt variant="caption" tone="muted">{picked ? 'Записи за день' : todayTitle()}</Txt>
          <Txt variant="title" style={{ fontFamily: font.extrabold, fontSize: 28, lineHeight: 34 }}>{label ?? 'Сегодня'}</Txt>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={streak ? `Серия: ${streak.days} ${daysWord(streak.days)} подряд` : 'Серия'}
          onPress={() => router.push('/streak')}
          style={[styles.streak, { backgroundColor: c.surface }]}>
          <View style={[styles.streakMascot, { backgroundColor: c.accentTint, borderColor: c.accent }]}>
            <Txt style={{ fontFamily: font.bold, fontSize: 10, color: c.accentText }}>ст.{streak?.stage ?? 1}</Txt>
          </View>
          <View>
            <Txt style={{ fontFamily: font.extrabold, fontSize: 17, lineHeight: 20 }}>{streak?.days ?? '—'}</Txt>
            <Txt style={{ fontFamily: font.medium, fontSize: 11, lineHeight: 14, color: c.muted }}>{daysWord(streak?.days ?? 0)}</Txt>
          </View>
        </Pressable>
      </View>

      <View style={styles.week}>
        {week.map((d, i) => {
          const isToday = i === week.length - 1;
          const on = picked ? d.date === picked : isToday;
          const fg = on ? c.onInk : c.ink;
          // Фиолетовая точка — день засчитан в серию, серая — есть фото, но меньше нормы
          const counted = d.meals >= (streak?.min_photos ?? 2);
          const dot = counted ? c.accent : d.meals ? c.muted : 'transparent';
          return (
            <Pressable
              key={d.date}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={isToday ? 'Сегодня' : dayLabel(d.date)}
              onPress={() => pickDay(d.date, isToday)}
              style={[styles.day, on && { backgroundColor: c.ink }]}>
              <Txt style={{ fontFamily: font.medium, fontSize: 11, lineHeight: 14, color: fg, opacity: 0.7 }}>{WEEKDAYS_SHORT[d.weekday]}</Txt>
              <Txt style={{ fontFamily: font.bold, fontSize: 15, lineHeight: 20, color: fg }}>{dayOfMonth(d.date)}</Txt>
              <View style={[styles.dayDot, { backgroundColor: dot }]} />
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.ringCard, { backgroundColor: c.surface }]}>
        <CalorieRing consumed={dayEaten.kcal} target={tg.kcal} />
        <Txt variant="caption" tone="muted">Съедено {fmt(dayEaten.kcal)} из {fmt(tg.kcal)} ккал по записанному</Txt>
      </View>

      <View style={styles.macros}>
        <MacroCard macro="protein" grams={dayEaten.protein} target={tg.protein} />
        <MacroCard macro="carbs" grams={dayEaten.carbs} target={tg.carbs} />
        <MacroCard macro="fat" grams={dayEaten.fat} target={tg.fat} />
      </View>

      <View style={{ gap: space[3] }}>
        <View style={styles.sectionHead}>
          <Txt variant="title" style={{ fontSize: 20, lineHeight: 26 }}>{t('Приёмы пищи')}</Txt>
          <Pressable accessibilityRole="button" onPress={addManual} hitSlop={8}>
            <Txt variant="headline" style={{ fontSize: 15, color: c.accentText }}>{t('+ Без фото')}</Txt>
          </Pressable>
        </View>
        {picked && loaded && meals.length === 0 && (
          <View style={[styles.empty, { backgroundColor: c.surface }]}>
            <Txt variant="headline" center>За {label} записей нет</Txt>
            <Txt variant="caption" tone="muted" center>{t('Забыли сфотографировать? Добавьте еду вручную — посчитаем по базе.')}</Txt>
            <Button title={t('Добавить без фото')} variant="secondary" onPress={addManual} />
          </View>
        )}
        {!picked && loaded && meals.length === 0 && (
          <View style={[styles.empty, { backgroundColor: c.surface }]}>
            <MascotSlot stage={streak?.stage ?? 1} size={96} />
            <Txt variant="headline" center>{t('Сегодня пока пусто')}</Txt>
            <Txt variant="caption" tone="muted" center>{t('Сфотографируйте первый приём пищи — разбор придёт сразу, а нутрициолог проверит его в течение 15 минут.')}</Txt>
            <Button title={t('Сфотографировать')} variant="accent" onPress={() => router.push('/camera')} />
          </View>
        )}
        {meals.map((m) => {
          const n = mealNutrients(m.items);
          return (
            <MealCard
              key={m.id}
              title={m.title}
              time={m.time}
              kcal={n.kcal}
              protein={n.protein}
              carbs={n.carbs}
              fat={n.fat}
              photo={m.photo}
              status={m.status}
              reviewerRole={m.reviewerRole}
              onPress={m.serverId ? () => router.push({ pathname: '/meal', params: { id: String(m.serverId) } }) : undefined}
            />
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  streak: { flexDirection: 'row', alignItems: 'center', gap: space[2], borderRadius: radius.full, paddingLeft: 4, paddingRight: 14, paddingVertical: 4 },
  streakMascot: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  week: { flexDirection: 'row', gap: 6 },
  day: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: space[2], borderRadius: 16 },
  dayDot: { width: 5, height: 5, borderRadius: 3 },
  ringCard: { borderRadius: radius.l, padding: space[5], alignItems: 'center', gap: space[3] },
  macros: { flexDirection: 'row', gap: space[2] },
  empty: { borderRadius: radius.m, padding: space[5], alignItems: 'center', gap: space[3] },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
});

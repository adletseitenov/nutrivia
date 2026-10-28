import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { MascotSlot } from '@/components/mascot-slot';
import { MealCard } from '@/components/meal-card';
import { CalorieRing, MacroCard } from '@/components/rings';
import { Screen } from '@/components/screen';
import { Txt } from '@/components/txt';
import { fmt } from '@/engine/engine';
import { dayOfMonth, daysWord, todayTitle, WEEKDAYS_SHORT } from '@/lib/dates';
import { mealNutrients, refreshToday, useAppStore, useTargets, useToday } from '@/store/app-store';
import { font, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

export default function Today() {
  const c = useColors();
  const { state, dispatch } = useAppStore();
  const t = useTargets();
  const eaten = useToday();
  const streak = state.progress?.streak;
  const week = state.progress?.week.days ?? [];

  // Свежий день с сервера при каждом открытии вкладки (статусы разборов, правки нутрициолога)
  useFocusEffect(
    useCallback(() => {
      refreshToday(dispatch);
    }, [dispatch]),
  );

  return (
    <Screen tabs>
      <View style={styles.head}>
        <View>
          <Txt variant="caption" tone="muted">{todayTitle()}</Txt>
          <Txt variant="title" style={{ fontFamily: font.extrabold, fontSize: 28, lineHeight: 34 }}>Сегодня</Txt>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={streak ? `Серия: ${streak.days} ${daysWord(streak.days)} подряд` : 'Серия'}
          onPress={() => router.push('/streak')}
          style={[styles.streak, { backgroundColor: c.surface }]}>
          <View style={[styles.streakMascot, { backgroundColor: c.greenTint, borderColor: c.green }]}>
            <Txt style={{ fontFamily: font.bold, fontSize: 10, color: c.greenText }}>ст.{streak?.stage ?? 1}</Txt>
          </View>
          <View>
            <Txt style={{ fontFamily: font.extrabold, fontSize: 17, lineHeight: 20 }}>{streak?.days ?? '—'}</Txt>
            <Txt style={{ fontFamily: font.medium, fontSize: 11, lineHeight: 14, color: c.muted }}>{daysWord(streak?.days ?? 0)}</Txt>
          </View>
        </Pressable>
      </View>

      <View style={styles.week}>
        {week.map((d, i) => {
          const today = i === week.length - 1;
          const fg = today ? c.onInk : c.ink;
          // Зелёная точка — день засчитан в серию, серая — есть фото, но меньше нормы
          const counted = d.meals >= (streak?.min_photos ?? 2);
          const dot = counted ? c.green : d.meals ? c.muted : 'transparent';
          return (
            <View key={d.date} style={[styles.day, today && { backgroundColor: c.ink }]}>
              <Txt style={{ fontFamily: font.medium, fontSize: 11, lineHeight: 14, color: fg, opacity: 0.7 }}>{WEEKDAYS_SHORT[d.weekday]}</Txt>
              <Txt style={{ fontFamily: font.bold, fontSize: 15, lineHeight: 20, color: fg }}>{dayOfMonth(d.date)}</Txt>
              <View style={[styles.dayDot, { backgroundColor: dot }]} />
            </View>
          );
        })}
      </View>

      <View style={[styles.ringCard, { backgroundColor: c.surface }]}>
        <CalorieRing consumed={eaten.kcal} target={t.kcal} />
        <Txt variant="caption" tone="muted">Съедено {fmt(eaten.kcal)} из {fmt(t.kcal)} ккал по записанному</Txt>
      </View>

      <View style={styles.macros}>
        <MacroCard macro="protein" grams={eaten.protein} target={t.protein} />
        <MacroCard macro="carbs" grams={eaten.carbs} target={t.carbs} />
        <MacroCard macro="fat" grams={eaten.fat} target={t.fat} />
      </View>

      <View style={{ gap: space[3] }}>
        <View style={styles.sectionHead}>
          <Txt variant="title" style={{ fontSize: 20, lineHeight: 26 }}>Приёмы пищи</Txt>
          {state.meals.length > 0 && <Txt variant="caption" tone="muted">{state.meals.length} за сегодня</Txt>}
        </View>
        {state.loaded && state.meals.length === 0 && (
          <View style={[styles.empty, { backgroundColor: c.surface }]}>
            <MascotSlot stage={streak?.stage ?? 1} size={96} />
            <Txt variant="headline" center>Сегодня пока пусто</Txt>
            <Txt variant="caption" tone="muted" center>Сфотографируйте первый приём пищи — разбор придёт сразу, а нутрициолог проверит его в течение 15 минут.</Txt>
            <Button title="Сфотографировать" variant="accent" onPress={() => router.push('/camera')} />
          </View>
        )}
        {state.meals.map((m) => {
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

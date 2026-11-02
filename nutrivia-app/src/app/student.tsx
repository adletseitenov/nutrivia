import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';

import {
  ApiError, getStudentCard, setStudentNote, setStudentTarget, setWeekComment, type StudentCard,
} from '@/api/client';
import { Button } from '@/components/button';
import { MealCard } from '@/components/meal-card';
import { RoundButton } from '@/components/round-button';
import { Screen } from '@/components/screen';
import { Txt } from '@/components/txt';
import { WeightCard } from '@/components/weight-card';
import { fmt, kgText } from '@/engine/engine';
import { ACTIVITIES } from '@/engine/targets';
import { WEEKDAYS_SHORT, daysWord } from '@/lib/dates';
import { GOALS, mealFromServer, mealNutrients, useAppStore } from '@/store/app-store';
import { font, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

const BAR_H = 64;

/** Карточка ученика (клиента) для тренера, нутрициолога или оператора: неделя, вес, приёмы пищи, ориентир, итог недели, заметка. */
export default function Student() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const sid = Number(id);
  // Оператор ведёт клиентов, тренер и нутрициолог — учеников
  const whom = useAppStore().state.me?.pro?.operator ? 'клиент' : 'ученик';
  const [card, setCard] = useState<StudentCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [note, setNote] = useState('');
  const [kcal, setKcal] = useState('');
  const [saved, setSaved] = useState<string | null>(null);

  const apply = useCallback((cd: StudentCard) => {
    setCard(cd);
    setComment(cd.week.coach.comment ?? '');
    setNote(cd.note);
    setKcal(cd.targets.set_by_pro ? String(cd.targets.kcal) : '');
  }, []);

  useFocusEffect(
    useCallback(() => {
      getStudentCard(sid).then(apply, (e) => setError(e instanceof ApiError ? e.message : 'Не получилось загрузить ученика.'));
    }, [sid, apply]),
  );

  async function run(what: string, fn: () => Promise<StudentCard | unknown>) {
    setSaved(null);
    setError(null);
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'week' in r) apply(r as StudentCard);
      setSaved(what);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось сохранить. Попробуйте ещё раз.');
    }
  }

  if (!card) {
    return (
      <Screen>
        <RoundButton icon="back" label="Назад" onPress={() => router.back()} />
        {error ? <Txt tone="warning">{error}</Txt> : <ActivityIndicator color={c.ink} />}
      </Screen>
    );
  }

  const p = card.profile;
  const goal = GOALS.find((g) => g.id === (card.goal === 'coach_plan' ? 'coach' : card.goal));
  const activity = ACTIVITIES.find((a) => a.id === p.activity);
  const params = [
    p.sex ? (p.sex === 'f' ? 'женщина' : 'мужчина') : null,
    p.birth_year ? `${new Date().getFullYear() - p.birth_year} лет` : null,
    p.height_cm ? `${p.height_cm} см` : null,
    p.weight_kg ? `${kgText(p.weight_kg)} кг` : null,
    activity?.title.toLowerCase(),
  ].filter(Boolean).join(' · ');
  const scaleMax = Math.max(card.targets.kcal * 1.2, ...card.week.days.map((d) => d.kcal));
  const kcalNum = Number(kcal);

  return (
    <Screen>
      <RoundButton icon="back" label="Назад" onPress={() => router.back()} />
      <View style={{ gap: 2 }}>
        <Txt variant="caption" tone="muted">{goal?.title ?? 'Цель не выбрана'}</Txt>
        <Txt variant="title" style={{ fontFamily: font.extrabold, fontSize: 28, lineHeight: 34 }}>{card.label}</Txt>
        <Txt variant="caption" tone="muted">{params || 'Параметры не указаны'}</Txt>
      </View>

      <View style={[styles.box, { backgroundColor: c.surface }]}>
        <View style={styles.row}>
          <Txt variant="headline" style={{ fontSize: 15 }}>Неделя</Txt>
          <Txt variant="caption" tone="muted">
            серия {card.streak.days} {daysWord(card.streak.days)} · в среднем {card.week.avg_kcal ? `${fmt(card.week.avg_kcal)} ккал` : '—'}
          </Txt>
        </View>
        <View style={styles.bars}>
          {card.week.days.map((d) => (
            <View key={d.date} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
              <View style={{ height: BAR_H, justifyContent: 'flex-end', width: '100%' }}>
                <View style={{
                  height: Math.max(d.kcal ? 4 : 0, (d.kcal / scaleMax) * BAR_H), borderRadius: 6,
                  backgroundColor: d.kcal > card.targets.kcal * 1.1 ? c.warning : c.accent,
                }} />
              </View>
              <Txt style={{ fontSize: 11, lineHeight: 14, color: c.muted }}>{WEEKDAYS_SHORT[d.weekday]}</Txt>
            </View>
          ))}
        </View>
      </View>

      <WeightCard data={card.weights} readOnly />

      <View style={[styles.box, { backgroundColor: c.surface }]}>
        <Txt variant="headline" style={{ fontSize: 15 }}>Ориентир на день</Txt>
        <Txt variant="caption" tone="muted">
          {card.targets.set_by_pro
            ? `Задан вами: ${fmt(card.targets.kcal)} ккал. Белок ${card.targets.protein} г.`
            : `Личный расчёт: ${fmt(card.targets.kcal)} ккал, белок ${card.targets.protein} г. Можно задать свой.`}
        </Txt>
        <View style={[styles.kcal, { backgroundColor: c.bg }]}>
          <TextInput value={kcal} onChangeText={(v) => setKcal(v.replace(/\D/g, '').slice(0, 4))}
            placeholder={String(card.targets.kcal)} placeholderTextColor={c.muted} keyboardType="number-pad"
            accessibilityLabel="Калории в день" style={[styles.kcalInput, { color: c.ink }]} />
          <Txt variant="caption" tone="muted">ккал в день</Txt>
        </View>
        <View style={styles.row}>
          <Button title="Задать" variant="accent" disabled={kcalNum < 1000 || kcalNum > 5000}
            onPress={() => run('target', () => setStudentTarget(sid, kcalNum))} />
          {card.targets.set_by_pro && (
            <Button title="Вернуть расчёт" variant="secondary" onPress={() => run('target', () => setStudentTarget(sid, null))} />
          )}
        </View>
        {saved === 'target' && <Txt variant="caption" tone="accent">Сохранено — {whom} видит новый ориентир.</Txt>}
      </View>

      <View style={[styles.box, { backgroundColor: c.surface }]}>
        <Txt variant="headline" style={{ fontSize: 15 }}>Итог недели</Txt>
        <Txt variant="caption" tone="muted">{whom === 'клиент' ? 'Клиент' : 'Ученик'} увидит его в «Прогрессе». Пустой — покажем последний комментарий к фото.</Txt>
        <TextInput value={comment} onChangeText={setComment} multiline placeholder="Что получилось, что поправить на следующей неделе"
          placeholderTextColor={c.muted} accessibilityLabel="Итог недели"
          style={[styles.area, { backgroundColor: c.bg, color: c.ink }]} />
        <Button title="Отправить итог" variant="accent" onPress={() => run('comment', () => setWeekComment(sid, comment))} />
        {saved === 'comment' && <Txt variant="caption" tone="accent">Отправлено.</Txt>}
      </View>

      <View style={[styles.box, { backgroundColor: c.surface }]}>
        <Txt variant="headline" style={{ fontSize: 15 }}>Заметка</Txt>
        <Txt variant="caption" tone="muted">Видите только вы: ограничения, договорённости, что важно помнить.</Txt>
        <TextInput value={note} onChangeText={setNote} multiline placeholder="Например: не ест после 20:00, аллергия на орехи"
          placeholderTextColor={c.muted} accessibilityLabel="Заметка"
          style={[styles.area, { backgroundColor: c.bg, color: c.ink }]} />
        <Button title="Сохранить заметку" variant="secondary" onPress={() => run('note', () => setStudentNote(sid, note))} />
        {saved === 'note' && <Txt variant="caption" tone="accent">Сохранено.</Txt>}
      </View>

      {error && <Txt variant="caption" tone="warning">{error}</Txt>}

      <View style={{ gap: space[3] }}>
        <Txt variant="title" style={{ fontSize: 20, lineHeight: 26 }}>Приёмы пищи за 2 недели</Txt>
        {card.meals.length === 0 && <Txt variant="caption" tone="muted">Пока нет записей.</Txt>}
        {card.meals.map((sm) => {
          const m = mealFromServer(sm);
          const n = mealNutrients(m.items);
          const d = new Date((sm.received_at ?? 0) * 1000);
          return (
            <MealCard key={m.id} title={m.title} time={`${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')} ${m.time}`}
              kcal={n.kcal} protein={n.protein} carbs={n.carbs} fat={n.fat}
              photo={sm.has_photo ? `pro:${sm.id}` : null} status={m.status} reviewerRole={m.reviewerRole}
              onPress={() => router.push({ pathname: '/pro-review', params: { id: String(sm.id) } })} />
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.m, padding: space[4], gap: space[3] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2], flexWrap: 'wrap' },
  bars: { flexDirection: 'row', gap: 8 },
  kcal: { flexDirection: 'row', alignItems: 'center', gap: space[2], borderRadius: radius.s, paddingHorizontal: space[3] },
  kcalInput: { flex: 1, fontFamily: font.bold, fontSize: 20, paddingVertical: space[3] },
  area: { minHeight: 88, borderRadius: radius.s, padding: space[3], fontFamily: font.regular, fontSize: 15, lineHeight: 22, textAlignVertical: 'top' },
});

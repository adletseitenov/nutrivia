import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { Txt } from '@/components/txt';
import { fmt } from '@/engine/engine';
import { rangeLabel, WEEKDAYS_SHORT } from '@/lib/dates';
import { refreshToday, useAppStore } from '@/store/app-store';
import { font, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

const CHART_H = 160;

/** Неделя по записанному рациону — данные сервера (GET /v1/progress). */
export default function Progress() {
  const c = useColors();
  const { state, dispatch } = useAppStore();

  useFocusEffect(
    useCallback(() => {
      refreshToday(dispatch);
    }, [dispatch]),
  );

  const week = state.progress?.week;
  if (!week) {
    return (
      <Screen tabs>
        <Txt variant="title" style={{ fontFamily: font.extrabold, fontSize: 28, lineHeight: 34 }}>Прогресс</Txt>
        <ActivityIndicator color={c.ink} style={{ marginTop: space[6] }} />
      </Screen>
    );
  }

  const target = week.targets.kcal;
  // Шкала: максимум недели или ориентир с запасом 20%, чтобы линия ориентира не упиралась в край
  const scaleMax = Math.max(target * 1.2, ...week.days.map((d) => d.kcal));
  const targetY = CHART_H - (target / scaleMax) * CHART_H;
  const first = week.days[0].date;
  const last = week.days[week.days.length - 1].date;

  return (
    <Screen tabs>
      <Txt variant="title" style={{ fontFamily: font.extrabold, fontSize: 28, lineHeight: 34 }}>Прогресс</Txt>

      <View style={[styles.card, { backgroundColor: c.surface }]}>
        <View>
          <Txt variant="caption" tone="muted">{rangeLabel(first, last)} · по записанному рациону</Txt>
          {week.avg_kcal !== null ? (
            <View style={{ marginTop: space[1] }}>
              <Txt style={{ fontFamily: font.extrabold, fontSize: 34, lineHeight: 40, letterSpacing: -1 }}>
                {fmt(week.avg_kcal)} <Txt variant="headline" tone="muted" style={{ letterSpacing: 0 }}>ккал</Txt>
              </Txt>
              <Txt variant="caption" tone="muted">в среднем за день с записями</Txt>
            </View>
          ) : (
            <Txt variant="headline" style={{ marginTop: space[2] }}>За неделю пока нет записей</Txt>
          )}
        </View>
        <View
          accessible
          accessibilityLabel={`Калории по дням: ${week.days
            .map((d) => `${WEEKDAYS_SHORT[d.weekday]} ${d.meals ? fmt(d.kcal) : 'нет записей'}`)
            .join(', ')}. Ориентир ${fmt(target)}.`}>
          <View style={styles.legend}>
            <View style={[styles.legendLine, { borderColor: c.muted }]} />
            <Txt style={[styles.legendText, { color: c.muted }]}>ориентир {fmt(target)} ккал</Txt>
          </View>
          <View style={{ height: CHART_H }}>
            <View style={styles.bars}>
              {week.days.map((d, i) => {
                const isToday = i === week.days.length - 1;
                const h = d.meals ? Math.max(6, (d.kcal / scaleMax) * CHART_H) : 6;
                return (
                  <View key={d.date} style={[styles.bar, { height: h, backgroundColor: !d.meals ? c.track : isToday ? c.green : c.ink }]} />
                );
              })}
            </View>
            <View pointerEvents="none" style={[styles.targetLine, { top: targetY, borderColor: c.muted }]} />
          </View>
          <View style={styles.labels}>
            {week.days.map((d, i) => {
              const isToday = i === week.days.length - 1;
              return (
                <Txt key={d.date} style={[styles.dayLabel, { color: isToday ? c.ink : c.muted, fontFamily: isToday ? font.bold : font.medium }]}>
                  {WEEKDAYS_SHORT[d.weekday]}
                </Txt>
              );
            })}
          </View>
        </View>
      </View>

      <View style={styles.stats}>
        {[
          [`${week.logged_days} / 7`, 'дней с записями'],
          [week.avg_protein !== null ? `${fmt(week.avg_protein)} г` : '—', 'белка в день'],
          [fmt(week.reviewed_photos), 'фото проверено'],
        ].map(([v, l]) => (
          <View key={l} style={[styles.stat, { backgroundColor: c.surface }]}>
            <Txt variant="numberM">{v}</Txt>
            <Txt variant="caption" tone="muted">{l}</Txt>
          </View>
        ))}
      </View>

      <View style={[styles.comment, { backgroundColor: c.surface }]}>
        <View style={styles.coach}>
          <View style={[styles.avatar, { backgroundColor: c.ink }]}>
            <Txt variant="label" style={{ color: c.onInk }}>
              {(week.coach.name ?? 'Н').slice(0, 1).toUpperCase()}
            </Txt>
          </View>
          <View>
            <Txt variant="headline" style={{ fontSize: 15, lineHeight: 20 }}>{week.coach.name ?? 'Нутрициолог Nutrivia'}</Txt>
            <Txt variant="caption" tone="muted">комментарий к неделе</Txt>
          </View>
        </View>
        <Txt style={{ fontSize: 15, lineHeight: 22, color: week.coach.comment ? c.ink : c.muted }}>
          {week.coach.comment ?? 'Комментарий появится после того, как нутрициолог проверит ваши разборы.'}
        </Txt>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.l, padding: space[5], gap: space[4] },
  targetLine: { position: 'absolute', left: -4, right: -4, borderTopWidth: 1.5, borderStyle: 'dashed', opacity: 0.8 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginBottom: space[3] },
  legendLine: { width: 18, borderTopWidth: 1.5, borderStyle: 'dashed' },
  legendText: { fontSize: 12, lineHeight: 16, fontFamily: font.medium },
  bars: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  bar: { flex: 1, borderRadius: 10 },
  labels: { flexDirection: 'row', gap: 10, marginTop: 6 },
  dayLabel: { flex: 1, textAlign: 'center', fontSize: 12, lineHeight: 14 },
  stats: { flexDirection: 'row', gap: space[2] },
  stat: { flex: 1, borderRadius: radius.m, padding: 14, gap: 4 },
  comment: { borderRadius: radius.m, padding: space[4], gap: 10 },
  coach: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});

import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { MascotSlot } from '@/components/mascot-slot';
import { RoundButton } from '@/components/round-button';
import { Screen } from '@/components/screen';
import { Txt } from '@/components/txt';
import { daysWord } from '@/lib/dates';
import { useAppStore, useTasks, type TaskId } from '@/store/app-store';
import { font, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

const TASKS: { id: TaskId; title: string; sub: string }[] = [
  { id: 'breakfast', title: 'Фото завтрака', sub: 'до 11:00' },
  { id: 'lunch', title: 'Фото обеда', sub: 'до 17:00' },
  { id: 'dinner', title: 'Фото ужина', sub: 'до 22:00' },
  { id: 'advice', title: 'Совет на вечер', sub: 'придёт в 19:00 — отметьте, если сделали' },
];

/** Серия и стадия маскота считаются на сервере (GET /v1/progress). */
export default function Streak() {
  const c = useColors();
  const { state, dispatch } = useAppStore();
  const tasks = useTasks();
  const s = state.progress?.streak;
  const done = TASKS.filter((t) => tasks[t.id]).length;

  if (!s) {
    return (
      <Screen>
        <RoundButton icon="back" label="Назад" onPress={() => router.back()} />
        <ActivityIndicator color={c.ink} style={{ marginTop: space[6] }} />
      </Screen>
    );
  }

  const toCount = Math.max(0, s.min_photos - s.photos_today);

  return (
    <Screen>
      <View style={styles.head}>
        <RoundButton icon="back" label="Назад" onPress={() => router.back()} />
        <Txt variant="headline">Серия</Txt>
        <View style={{ width: 44 }} />
      </View>

      <View style={{ alignItems: 'center', gap: space[3] }}>
        <MascotSlot stage={s.stage} size={168} />
        <Txt style={{ fontFamily: font.extrabold, fontSize: 40, lineHeight: 44, letterSpacing: -1 }}>
          {s.days} {daysWord(s.days)} подряд
        </Txt>
        <Txt variant="caption" tone="muted" center style={{ fontSize: 14 }}>
          {s.next_stage_in !== null
            ? `Ещё ${s.next_stage_in} ${daysWord(s.next_stage_in)} подряд — и маскот вырастет до стадии ${s.stage + 1}`
            : 'Маскот вырос полностью'}
        </Txt>
        <Txt variant="caption" tone={s.today_counted ? 'green' : 'muted'} center>
          {s.today_counted
            ? 'Сегодня засчитано'
            : `Чтобы засчитать сегодня, нужно ещё ${toCount} фото еды`}
        </Txt>
      </View>

      <View style={styles.stages}>
        {s.stage_days.map((d, i) => {
          const passed = i + 1 < s.stage;
          const now = i + 1 === s.stage;
          return (
            <View key={d} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
              <View style={[styles.stageBar, { backgroundColor: passed ? c.green : now ? c.ink : c.track }]} />
              <Txt style={{ fontSize: 12, lineHeight: 16, fontFamily: now ? font.bold : font.medium, color: now || passed ? c.ink : c.muted }}>
                {i === 0 ? 'Росток' : `Стадия ${i + 1}`}
              </Txt>
              <Txt style={{ fontSize: 11, lineHeight: 14, fontFamily: font.medium, color: c.muted }}>
                {d === 0 ? 'старт' : `${d} ${daysWord(d)}`}
              </Txt>
            </View>
          );
        })}
      </View>

      <View style={[styles.tasks, { backgroundColor: c.surface }]}>
        <View style={styles.tasksHead}>
          <Txt variant="headline">Задания на сегодня</Txt>
          <Txt variant="label" tone="green" style={{ fontSize: 13 }}>{done} из {TASKS.length}</Txt>
        </View>
        {TASKS.map((t) => {
          const on = tasks[t.id];
          // Фото засчитываются сами по приёмам пищи; вручную отмечается только совет
          const manual = t.id === 'advice';
          return (
            <Pressable
              key={t.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, disabled: !manual }}
              disabled={!manual}
              onPress={() => { Haptics.selectionAsync(); dispatch({ type: 'toggleAdvice' }); }}
              style={styles.task}>
              <View style={[styles.box, on ? { backgroundColor: c.green } : { borderWidth: 1.75, borderColor: c.muted }]}>
                {on && <Icon name="check" size={16} color={c.onGreen} strokeWidth={2.4} />}
              </View>
              <View style={{ flex: 1 }}>
                <Txt
                  variant="headline"
                  style={{ fontSize: 15, lineHeight: 20, color: on ? c.muted : c.ink, textDecorationLine: on ? 'line-through' : 'none' }}>
                  {t.title}
                </Txt>
                <Txt variant="caption" tone="muted" style={{ fontSize: 12, lineHeight: 16 }}>{t.sub}</Txt>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Txt variant="caption" tone="muted" center>
        День засчитывается, если есть хотя бы {s.min_photos} фото еды. Пропустили день — маскот опустится на одну стадию, а не в ноль.
        {s.best > s.days ? ` Лучшая серия: ${s.best} ${daysWord(s.best)}.` : ''}
      </Txt>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stages: { flexDirection: 'row', gap: 6 },
  stageBar: { alignSelf: 'stretch', height: 8, borderRadius: 4 },
  tasks: { borderRadius: radius.m, padding: space[4], gap: space[2] },
  tasksHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: space[1] },
  task: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 44 },
  box: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});

import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { MascotSlot, stageName } from '@/components/mascot-slot';
import { RoundButton } from '@/components/round-button';
import { Screen } from '@/components/screen';
import { Txt } from '@/components/txt';
import { daysWord } from '@/lib/dates';
import { useAppStore, useTasks, type TaskId } from '@/store/app-store';
import { font, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';
import { t, t as tr } from '@/lib/i18n';

const TASKS: { id: TaskId; title: string; sub: string }[] = [
  { id: 'breakfast', title: 'Фото завтрака', sub: 'до 11:00' },
  { id: 'lunch', title: 'Фото обеда', sub: 'до 17:00' },
  { id: 'dinner', title: 'Фото ужина', sub: 'до 22:00' },
  { id: 'advice', title: 'Совет на вечер', sub: 'на «Сегодня» после 16:00 — отметьте, если сделали' },
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
        <RoundButton icon="back" label={t('Назад')} onPress={() => router.back()} />
        <ActivityIndicator color={c.ink} style={{ marginTop: space[6] }} />
      </Screen>
    );
  }

  const toCount = Math.max(0, s.min_photos - s.photos_today);
  // Серия оборвалась вчера: сегодня ещё не засчитан, а раньше серия была
  const missed = s.days === 0 && s.best > 0 && !s.today_counted;

  return (
    <Screen>
      <View style={styles.head}>
        <RoundButton icon="back" label={t('Назад')} onPress={() => router.back()} />
        <Txt variant="headline">{t('Серия')}</Txt>
        <View style={{ width: 44 }} />
      </View>

      <View style={{ alignItems: 'center', gap: space[3] }}>
        <MascotSlot stage={s.stage} size={168} />
        <Txt variant="label" tone="accent">{t('Стадия')} {s.stage} · {t(stageName(s.stage))}</Txt>
        <Txt style={{ fontFamily: font.extrabold, fontSize: 40, lineHeight: 44, letterSpacing: -1 }}>
          {s.days} {daysWord(s.days)} {t('подряд')}
        </Txt>
        <Txt variant="caption" tone="muted" center style={{ fontSize: 14 }}>
          {s.next_stage_in !== null
            ? `${t('Ещё')} ${s.next_stage_in} ${daysWord(s.next_stage_in)} ${t('подряд — и вырастет')}: ${t(stageName(s.stage + 1)).toLowerCase()}`
            : t('Голубика выросла полностью')}
        </Txt>
        <Txt variant="caption" tone={s.today_counted ? 'accent' : 'muted'} center>
          {s.today_counted
            ? t('Сегодня засчитано')
            : `${t('Чтобы засчитать сегодня, нужно ещё')} ${toCount} ${t('фото еды')}`}
        </Txt>
      </View>

      {missed && (
        <View style={[styles.missed, { backgroundColor: c.accentTint }]}>
          <Txt variant="headline" style={{ fontSize: 15 }}>{t('Вчера без фото — серия началась заново')}</Txt>
          <Txt variant="caption">
            {t('Голубика не завяла: стадия опустилась только на одну. Два фото сегодня — и серия снова пошла.')}
          </Txt>
        </View>
      )}

      {/* Путь голубики: открытые стадии в цвете, текущая в рамке, будущие — силуэтом */}
      <View style={styles.stages} accessibilityRole="list">
        {s.stage_days.map((d, i) => {
          const n = i + 1;
          const now = n === s.stage;
          const open = n <= s.stage;
          return (
            <View key={d} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
              <View style={[styles.stageCell, now && { borderColor: c.accent, backgroundColor: c.accentTint }]}>
                <MascotSlot stage={n} size={48} locked={!open} />
              </View>
              <Txt style={{ fontSize: 12, lineHeight: 16, fontFamily: now ? font.bold : font.medium, color: open ? c.ink : c.muted }}>
                {t(stageName(n))}
              </Txt>
              <Txt style={{ fontSize: 11, lineHeight: 14, fontFamily: font.medium, color: c.muted }}>
                {d === 0 ? t('старт') : `${d} ${daysWord(d)}`}
              </Txt>
            </View>
          );
        })}
      </View>

      <View style={[styles.tasks, { backgroundColor: c.surface }]}>
        <View style={styles.tasksHead}>
          <Txt variant="headline">{t('Задания на сегодня')}</Txt>
          <Txt variant="label" tone="accent" style={{ fontSize: 13 }}>{done} из {TASKS.length}</Txt>
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
              <View style={[styles.box, on ? { backgroundColor: c.accent } : { borderWidth: 1.75, borderColor: c.muted }]}>
                {on && <Icon name="check" size={16} color={c.onAccent} strokeWidth={2.4} />}
              </View>
              <View style={{ flex: 1 }}>
                <Txt
                  variant="headline"
                  style={{ fontSize: 15, lineHeight: 20, color: on ? c.muted : c.ink, textDecorationLine: on ? 'line-through' : 'none' }}>
                  {tr(t.title)}
                </Txt>
                <Txt variant="caption" tone="muted" style={{ fontSize: 12, lineHeight: 16 }}>{tr(t.sub)}</Txt>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Txt variant="caption" tone="muted" center>
        {t('День засчитывается, если есть хотя бы')} {s.min_photos} {t('фото еды. Пропустили день — стадия опустится на одну, а не в ноль.')}
        {s.best > s.days ? ` ${t('Лучшая серия')}: ${s.best} ${daysWord(s.best)}.` : ''}
      </Txt>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stages: { flexDirection: 'row', gap: 6 },
  stageCell: { width: 60, height: 60, borderRadius: 18, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  missed: { borderRadius: radius.m, padding: space[4], gap: space[1] },
  tasks: { borderRadius: radius.m, padding: space[4], gap: space[2] },
  tasksHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: space[1] },
  task: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 44 },
  box: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});

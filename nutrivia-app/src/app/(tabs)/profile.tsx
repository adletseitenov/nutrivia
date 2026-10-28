import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { deleteMe, logout } from '@/api/client';
import { Icon } from '@/components/icon';
import { Screen } from '@/components/screen';
import { Txt } from '@/components/txt';
import { fmt } from '@/engine/engine';
import { GOALS, useAppStore, useTargets } from '@/store/app-store';
import { font, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

export default function Profile() {
  const c = useColors();
  const { state, dispatch } = useAppStore();
  const t = useTargets();
  const goal = GOALS.find((g) => g.id === state.goal)!;

  const rows: { label: string; value: string; onPress?: () => void }[] = [
    { label: 'Цель', value: goal.title, onPress: () => router.push('/goal') },
    { label: 'Ориентир на день', value: `${fmt(t.kcal)} ккал` },
    state.me?.coach
      ? { label: 'Тренер или нутрициолог', value: state.me.coach.name }
      : { label: 'Тренер или нутрициолог', value: 'Ввести код', onPress: () => router.push('/join') },
    { label: 'Язык', value: 'Русский' },
  ];

  return (
    <Screen tabs>
      <Txt variant="title" style={{ fontFamily: font.extrabold, fontSize: 28, lineHeight: 34 }}>Профиль</Txt>
      <View style={[styles.group, { backgroundColor: c.surface }]}>
        {rows.map((r, i) => (
          <Pressable
            key={r.label}
            onPress={r.onPress}
            disabled={!r.onPress}
            accessibilityRole={r.onPress ? 'button' : undefined}
            style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}>
            <Txt variant="caption" tone="muted" style={{ fontSize: 15 }}>{r.label}</Txt>
            <View style={styles.value}>
              <Txt variant="headline" style={{ fontSize: 15 }} numberOfLines={1}>{r.value}</Txt>
              {r.onPress && (
                <View style={{ transform: [{ rotate: '180deg' }] }}>
                  <Icon name="back" size={16} color={c.muted} />
                </View>
              )}
            </View>
          </Pressable>
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={async () => {
          await logout().catch(() => {});
          dispatch({ type: 'reset' });
          router.replace('/welcome');
        }}
        style={[styles.danger, { backgroundColor: c.surface }]}>
        <Txt variant="headline" style={{ fontSize: 15 }}>Выйти</Txt>
      </Pressable>
      <Txt variant="caption" tone="muted">
        Удалить аккаунт и все фото можно в любой момент — данные стираются с сервера полностью.
      </Txt>
      <Pressable
        accessibilityRole="button"
        onPress={async () => {
          try {
            await deleteMe();
          } catch {
            return; // нет связи — данные не удалены, ничего не сбрасываем
          }
          dispatch({ type: 'reset' });
          router.replace('/welcome');
        }}
        style={[styles.danger, { backgroundColor: c.surface }]}>
        <Txt variant="headline" tone="warning" style={{ fontSize: 15 }}>Удалить мои данные</Txt>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { borderRadius: radius.m, overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space[4], minHeight: 52, gap: space[3] },
  value: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  danger: { borderRadius: radius.m, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
});

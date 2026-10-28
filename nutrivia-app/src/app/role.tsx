import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import type { Role } from '@/api/client';
import { Button } from '@/components/button';
import { RoundButton } from '@/components/round-button';
import { Screen } from '@/components/screen';
import { Txt } from '@/components/txt';
import { useAppStore } from '@/store/app-store';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

const ROLES: { id: Role; title: string; sub: string }[] = [
  { id: 'client', title: 'Для себя', sub: 'Слежу за своим питанием' },
  { id: 'trainer', title: 'Тренер', sub: 'Веду до 5 учеников' },
  { id: 'nutritionist', title: 'Нутрициолог', sub: 'Веду клиентов и проверяю разборы' },
];

/** Тип аккаунта при регистрации (Алан, 27.10): для себя, тренер, нутрициолог. */
export default function RoleScreen() {
  const c = useColors();
  const { state, dispatch } = useAppStore();
  const role = state.signup.role;

  return (
    <Screen
      footer={
        <Button
          title="Продолжить"
          block
          onPress={() => router.push(role === 'client' ? '/goal' : '/pro-name')}
        />
      }>
      <View style={styles.head}>
        <RoundButton icon="back" label="Назад" onPress={() => router.back()} />
        <View style={[styles.progress, { backgroundColor: c.track }]}>
          <View style={[styles.progressFill, { backgroundColor: c.ink, width: '25%' }]} />
        </View>
        <Txt variant="caption" tone="muted">1 из 4</Txt>
      </View>

      <View style={{ gap: space[2] }}>
        <Txt variant="display">Кто вы?</Txt>
        <Txt tone="muted">От этого зависит, что будет в приложении: свой дневник или кабинет с учениками.</Txt>
      </View>

      <View style={{ gap: space[3] }} accessibilityRole="radiogroup">
        {ROLES.map((r) => {
          const on = r.id === role;
          return (
            <Pressable
              key={r.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => {
                Haptics.selectionAsync();
                dispatch({ type: 'setSignup', patch: { role: r.id } });
              }}
              style={[styles.option, { backgroundColor: on ? c.ink : c.surface }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="headline" style={{ color: on ? c.onInk : c.ink }}>{r.title}</Txt>
                <Txt variant="caption" style={{ color: on ? c.onInk : c.muted, opacity: on ? 0.72 : 1 }}>{r.sub}</Txt>
              </View>
              <View
                style={[
                  styles.radio,
                  on ? { backgroundColor: c.green, borderWidth: 6, borderColor: c.onInk } : { borderWidth: 1.75, borderColor: c.muted },
                ]}
              />
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  progress: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2 },
  option: { minHeight: 72, borderRadius: radius.m, paddingHorizontal: space[4], paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: space[3] },
  radio: { width: 22, height: 22, borderRadius: 11 },
});

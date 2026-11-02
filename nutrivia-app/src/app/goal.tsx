import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { bodyFromMe, patchGoal } from '@/api/client';
import { Button } from '@/components/button';
import { RoundButton } from '@/components/round-button';
import { Screen } from '@/components/screen';
import { Txt } from '@/components/txt';
import { fmt } from '@/engine/engine';
import { personalTargets } from '@/engine/targets';
import { GOALS, useAppStore } from '@/store/app-store';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

export default function GoalScreen() {
  const c = useColors();
  const { state, dispatch } = useAppStore();
  const picked = GOALS.find((g) => g.id === state.goal)!;
  // Личный ориентир, если параметры уже известны; иначе — средний по цели
  const body = state.onboarded ? bodyFromMe(state.me) : state.signup.body;
  const own = body && picked.kcal ? personalTargets(body, picked.id) : null;
  const target = own
    ? `${fmt(own.kcal)} ккал · белок ${own.protein} г`
    : picked.kcal ? `≈${fmt(picked.kcal)} ккал` : 'задаст нутрициолог';

  return (
    <Screen
      footer={
        <Button
          title="Продолжить"
          block
          onPress={() => {
            if (!state.onboarded) return router.push('/body'); // цель уйдёт на сервер вместе с регистрацией
            // смена цели из профиля
            patchGoal(state.goal).then((me) => dispatch({ type: 'setMe', me })).catch(() => {});
            router.back();
          }}
        />
      }>
      <View style={styles.head}>
        <RoundButton icon="back" label="Назад" onPress={() => router.back()} />
        <View style={[styles.progress, { backgroundColor: c.track }]}>
          <View style={[styles.progressFill, { backgroundColor: c.ink }]} />
        </View>
        <Txt variant="caption" tone="muted">2 из 5</Txt>
      </View>

      <View style={{ gap: space[2] }}>
        <Txt variant="display">Какая у вас цель?</Txt>
        <Txt tone="muted">По ней и вашим параметрам посчитаем ориентир на день. Нутрициолог сможет его поменять.</Txt>
      </View>

      <View style={{ gap: space[3] }} accessibilityRole="radiogroup">
        {GOALS.map((g) => {
          const on = g.id === state.goal;
          return (
            <Pressable
              key={g.id}
              accessibilityRole="radio"
              accessibilityLabel={g.title}
              accessibilityState={{ checked: on }}
              onPress={() => {
                Haptics.selectionAsync();
                dispatch({ type: 'setGoal', goal: g.id });
              }}
              style={[styles.option, { backgroundColor: on ? c.ink : c.surface }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="headline" style={{ color: on ? c.onInk : c.ink }}>{g.title}</Txt>
                <Txt variant="caption" style={{ color: on ? c.onInk : c.muted, opacity: on ? 0.72 : 1 }}>{g.sub}</Txt>
              </View>
              <View
                style={[
                  styles.radio,
                  on ? { backgroundColor: c.accent, borderWidth: 6, borderColor: c.onInk } : { borderWidth: 1.75, borderColor: c.muted },
                ]}
              />
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.target, { backgroundColor: c.surface }]}>
        <Txt variant="caption" tone="muted">Ориентир на день</Txt>
        <Txt variant="headline" style={{ fontSize: 15 }} numberOfLines={1}>{target}</Txt>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  progress: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { width: '40%', height: 4, borderRadius: 2 },
  option: { minHeight: 72, borderRadius: radius.m, paddingHorizontal: space[4], paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: space[3] },
  radio: { width: 22, height: 22, borderRadius: 11 },
  target: { borderRadius: radius.m, padding: space[4], flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space[3] },
});

import { router } from 'expo-router';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Button } from '@/components/button';
import { MealPhoto } from '@/components/meal-photo';
import { MacroDots } from '@/components/rings';
import { Screen } from '@/components/screen';
import { StatusPill } from '@/components/status-pill';
import { Txt } from '@/components/txt';
import { compute, getDish } from '@/engine/engine';
import { font, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

export default function Welcome() {
  const c = useColors();
  const { width } = useWindowDimensions();
  const photoW = width - space[5] * 2;
  const plov = compute(getDish('plov'), 450);

  return (
    <Screen
      footer={
        <>
          <Txt variant="caption" tone="muted" center style={{ fontSize: 12, lineHeight: 16 }}>
            Нажимая «Начать» или «Войти», вы подтверждаете, что вам есть 18 лет, и соглашаетесь, что мы храним ваши фото еды и
            разборы и показываем их нутрициологу. Разбор — оценка по фото, не медицинская консультация. Удалить все
            данные можно в профиле.
          </Txt>
          <Button title="Начать" block onPress={() => router.push('/role')} />
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/phone', params: { mode: 'login' } })}
            hitSlop={8}
            style={{ alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: space[3] }}>
            <Txt variant="caption" tone="muted" center>
              Уже есть аккаунт? <Txt variant="caption" style={{ fontFamily: font.semibold }}>Войти</Txt>
            </Txt>
          </Pressable>
        </>
      }>
      <View style={styles.top}>
        <Txt style={{ fontFamily: font.extrabold, fontSize: 22, lineHeight: 28, letterSpacing: -0.6 }}>Nutrivia</Txt>
        <Pressable accessibilityRole="button" style={[styles.lang, { backgroundColor: c.surface }]}>
          <Txt variant="label">Қазақша</Txt>
        </Pressable>
      </View>

      <View style={{ height: 340 }}>
        <MealPhoto uri="demo:plov" width={photoW} height={290} radius={radius.l} />
        <View style={styles.pill}><StatusPill status="reviewed" /></View>
        <View style={[styles.float, { backgroundColor: c.surfaceRaised }]}>
          <View style={styles.row}>
            <Txt variant="headline">Плов, 1½ пиалы</Txt>
            <Txt variant="caption" tone="muted">≈450 г</Txt>
          </View>
          <View style={[styles.row, { justifyContent: 'flex-start', gap: space[4] }]}>
            <Txt style={{ fontFamily: font.extrabold, fontSize: 28, lineHeight: 32 }}>
              {Math.round(plov.kcal)} <Txt variant="caption" tone="muted">ккал</Txt>
            </Txt>
            <MacroDots protein={plov.protein} carbs={plov.carbs} fat={plov.fat} />
          </View>
        </View>
      </View>

      <View style={{ gap: space[3] }}>
        <Txt variant="display">Сфотографируйте еду. Остальное сделаем мы.</Txt>
        <Txt tone="muted">Разбор по фото проверяет живой нутрициолог — ответ в течение 15 минут.</Txt>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lang: { borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 8 },
  pill: { position: 'absolute', top: space[4], left: space[4] },
  float: {
    position: 'absolute', left: space[5], right: space[5], bottom: 0, borderRadius: radius.m, padding: space[4], gap: space[2],
    shadowColor: '#0B0D0C', shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 12 }, elevation: 6,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});

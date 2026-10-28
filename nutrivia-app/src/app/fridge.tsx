import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { analyzeFridgePhoto, FRIDGE_IDEAS } from '@/api/vision';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { RoundButton } from '@/components/round-button';
import { Screen } from '@/components/screen';
import { Txt } from '@/components/txt';
import { fmt } from '@/engine/engine';
import { mealNutrients, useTargets, useToday } from '@/store/app-store';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

export default function Fridge() {
  const c = useColors();
  const { photo } = useLocalSearchParams<{ photo?: string }>();
  const t = useTargets();
  const eaten = useToday();
  const [products, setProducts] = useState<string[] | null>(null);

  useEffect(() => {
    analyzeFridgePhoto(photo ?? '').then(setProducts);
  }, [photo]);

  const left = Math.max(0, t.kcal - eaten.kcal);
  const proteinLeft = Math.max(0, t.protein - eaten.protein);
  const ideas = (products ? FRIDGE_IDEAS.filter((i) => i.needs.every((n) => products.includes(n))) : [])
    .map((i) => ({ ...i, n: mealNutrients(i.items) }))
    .filter((i) => i.n.kcal <= Math.max(left, 250))
    .slice(0, 3);

  return (
    <Screen>
      <View style={styles.head}>
        <RoundButton icon="back" label="Назад" onPress={() => router.back()} />
        <View style={{ flex: 1 }}>
          <Txt variant="title">Что приготовить</Txt>
          <Txt variant="caption" tone="muted">
            {products ? `Нашли на фото ${products.length} продуктов · оценка по фото` : 'Разбираем фото холодильника…'}
          </Txt>
        </View>
      </View>

      {!products ? (
        <ActivityIndicator color={c.ink} style={{ marginTop: space[6] }} />
      ) : (
        <>
          <View style={styles.chips}>
            {products.map((p) => (
              <Pressable
                key={p}
                accessibilityRole="button"
                accessibilityLabel={`Убрать: ${p}`}
                onPress={() => { Haptics.selectionAsync(); setProducts(products.filter((x) => x !== p)); }}
                style={[styles.chip, { backgroundColor: c.surface }]}>
                <Txt variant="label" style={{ fontSize: 14, lineHeight: 18 }}>{p}</Txt>
                <Icon name="close" size={14} color={c.muted} strokeWidth={2} />
              </Pressable>
            ))}
            <Pressable accessibilityRole="button" style={[styles.chip, styles.addChip, { borderColor: c.line }]}>
              <Txt variant="label" tone="green" style={{ fontSize: 14, lineHeight: 18 }}>+ Добавить</Txt>
            </Pressable>
          </View>

          <View style={[styles.left, { backgroundColor: c.surface }]}>
            <View style={styles.row}>
              <Txt variant="caption" tone="muted">Осталось на сегодня</Txt>
              <Txt variant="headline">{fmt(left)} ккал · белок {fmt(proteinLeft)} г</Txt>
            </View>
            <View style={[styles.track, { backgroundColor: c.track }]}>
              <View style={{ width: `${Math.min(100, (eaten.kcal / t.kcal) * 100)}%`, height: 6, borderRadius: 3, backgroundColor: c.green }} />
            </View>
          </View>

          <Txt variant="title" style={{ fontSize: 20, lineHeight: 26 }}>Подойдёт на ужин</Txt>
          <View style={{ gap: 10 }}>
            {ideas.length === 0 && <Txt tone="muted">Из этих продуктов в базе пока нет подходящих блюд.</Txt>}
            {ideas.map((i) => (
              <View key={i.name} style={[styles.idea, { backgroundColor: c.surface }]}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Txt variant="headline" style={{ fontSize: 16, lineHeight: 22 }}>{i.name}</Txt>
                  <Txt variant="caption" tone="muted">{i.from}</Txt>
                  <Txt variant="caption" tone="muted">
                    <Txt variant="caption" style={{ fontWeight: '700' }}>{fmt(i.n.kcal)} ккал</Txt> · белок {fmt(i.n.protein)} г · {i.minutes} мин
                  </Txt>
                </View>
                <Button
                  title="В план"
                  variant="secondary"
                  size="s"
                  style={{ backgroundColor: c.bg }}
                  onPress={() => router.dismissTo('/today')}
                />
              </View>
            ))}
          </View>
          <Txt variant="caption" tone="muted" style={{ fontSize: 12, lineHeight: 16 }}>
            Блюда из нашей базы, порции подобраны под остаток дня. Продукты могли распознаться неточно — уберите лишние.
          </Txt>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.full, paddingLeft: 14, paddingRight: 10, paddingVertical: 8, minHeight: 36 },
  addChip: { borderWidth: 1.5, borderStyle: 'dashed', paddingRight: 14 },
  left: { borderRadius: radius.m, paddingHorizontal: space[4], paddingVertical: 14, gap: space[2] },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space[2] },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  idea: { borderRadius: radius.m, padding: 14, paddingLeft: space[4], flexDirection: 'row', alignItems: 'center', gap: space[3] },
});

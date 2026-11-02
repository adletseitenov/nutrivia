import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { addManualMeal, ApiError, fridgeIdeas, uploadFridge, type FridgeIdea, type FridgeResult } from '@/api/client';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { RoundButton } from '@/components/round-button';
import { Screen } from '@/components/screen';
import { Txt } from '@/components/txt';
import { fmt } from '@/engine/engine';
import { refreshToday, useAppStore, useTargets, useToday } from '@/store/app-store';
import { font, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';
import { t } from '@/lib/i18n';

/** Фото холодильника → продукты (ИИ) → блюда из базы под остаток дня (Engine). Продукты можно поправить. */
export default function Fridge() {
  const c = useColors();
  const { dispatch } = useAppStore();
  const { photo } = useLocalSearchParams<{ photo?: string }>();
  const tg = useTargets();
  const eaten = useToday();
  const [res, setRes] = useState<FridgeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [extra, setExtra] = useState('');
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    uploadFridge(photo ?? '').then(
      (r) => alive && setRes(r),
      (e) => alive && setError(e instanceof ApiError ? e.message : 'Не получилось разобрать фото.'),
    );
    return () => { alive = false; };
  }, [photo]);

  function update(products: string[]) {
    setRes((r) => (r ? { ...r, products } : r));
    fridgeIdeas(products).then(setRes, () => {});
  }

  async function eat(idea: FridgeIdea) {
    try {
      await addManualMeal(idea.items.map((i) => ({ dish_id: i.dish_id, grams: i.grams })));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refreshToday(dispatch);
      setSaved(idea.title);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось записать.');
    }
  }

  const left = Math.max(0, tg.kcal - eaten.kcal);
  const proteinLeft = Math.max(0, tg.protein - eaten.protein);
  const products = res?.products ?? [];

  return (
    <Screen>
      <View style={styles.head}>
        <RoundButton icon="back" label={t('Назад')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/today'))} />
        <View style={{ flex: 1 }}>
          <Txt variant="title">{t('Что приготовить')}</Txt>
          <Txt variant="caption" tone="muted">
            {res ? `Нашли на фото: ${products.length} · оценка по фото` : error ? 'Разбор не получился' : 'Разбираем фото холодильника…'}
          </Txt>
        </View>
      </View>

      {error && (
        <View style={{ gap: space[3] }}>
          <Txt tone="warning">{error}</Txt>
          <Button title={t('Снять ещё раз')} onPress={() => router.replace('/camera')} />
        </View>
      )}
      {!res && !error && <ActivityIndicator color={c.ink} style={{ marginTop: space[6] }} />}
      {res && (
        <>
          <View style={styles.chips}>
            {products.map((p) => (
              <Pressable
                key={p}
                accessibilityRole="button"
                accessibilityLabel={`Убрать: ${p}`}
                onPress={() => { Haptics.selectionAsync(); update(products.filter((x) => x !== p)); }}
                style={[styles.chip, { backgroundColor: c.surface }]}>
                <Txt variant="label" style={{ fontSize: 14, lineHeight: 18 }}>{p}</Txt>
                <Icon name="close" size={14} color={c.muted} strokeWidth={2} />
              </Pressable>
            ))}
            {adding ? (
              <TextInput
                autoFocus
                value={extra}
                onChangeText={setExtra}
                placeholder={t('например, рис')}
                placeholderTextColor={c.muted}
                returnKeyType="done"
                accessibilityLabel={t('Добавить продукт')}
                onSubmitEditing={() => {
                  const v = extra.trim().toLowerCase();
                  setAdding(false);
                  setExtra('');
                  if (v && !products.includes(v)) update([...products, v]);
                }}
                onBlur={() => setAdding(false)}
                style={[styles.chip, styles.input, { borderColor: c.accent, color: c.ink }]}
              />
            ) : (
              <Pressable accessibilityRole="button" onPress={() => setAdding(true)} style={[styles.chip, styles.addChip, { borderColor: c.line }]}>
                <Txt variant="label" tone="accent" style={{ fontSize: 14, lineHeight: 18 }}>+ Добавить</Txt>
              </Pressable>
            )}
          </View>

          <View style={[styles.left, { backgroundColor: c.surface }]}>
            <View style={styles.row}>
              <Txt variant="caption" tone="muted">{t('Осталось на сегодня')}</Txt>
              <Txt variant="headline">{fmt(left)} ккал · белок {fmt(proteinLeft)} г</Txt>
            </View>
            <View style={[styles.track, { backgroundColor: c.track }]}>
              <View style={{ width: `${Math.min(100, (eaten.kcal / tg.kcal) * 100)}%`, height: 6, borderRadius: 3, backgroundColor: c.accent }} />
            </View>
          </View>

          <Txt variant="title" style={{ fontSize: 20, lineHeight: 26 }}>{t('Можно приготовить')}</Txt>
          <View style={{ gap: 10 }}>
            {res.ideas.length === 0 && (
              <Txt tone="muted">{t('Из этих продуктов в базе пока нет готовых блюд. Добавьте продукт или снимите полку целиком.')}</Txt>
            )}
            {res.ideas.map((i) => (
              <View key={i.title} style={[styles.idea, { backgroundColor: c.surface }]}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Txt variant="headline" style={{ fontSize: 16, lineHeight: 22 }}>{i.title}</Txt>
                  <Txt variant="caption" tone="muted">{i.items.map((x) => `${x.name.toLowerCase()} ${x.grams} г`).join(', ')}</Txt>
                  <Txt variant="caption" tone="muted">
                    <Txt variant="caption" style={{ fontFamily: font.bold }}>{fmt(i.kcal)} ккал</Txt> · белок {fmt(i.protein)} г · {i.minutes} мин
                    {i.smaller ? ' · порция меньше обычной' : ''}
                  </Txt>
                </View>
                <Button
                  title={saved === i.title ? 'Записано' : 'Съел'}
                  variant="secondary"
                  size="s"
                  disabled={saved === i.title}
                  style={{ backgroundColor: c.bg }}
                  onPress={() => eat(i)}
                />
              </View>
            ))}
          </View>
          <Txt variant="caption" tone="muted" style={{ fontSize: 12, lineHeight: 16 }}>
            Блюда из нашей базы, порции подобраны под остаток дня. Продукты могли распознаться неточно — уберите лишние или
            добавьте свои. «Съел» записывает блюдо в день без фото.
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
  input: { borderWidth: 1.5, minWidth: 140, paddingRight: 14, fontFamily: font.semibold, fontSize: 14 },
  left: { borderRadius: radius.m, paddingHorizontal: space[4], paddingVertical: 14, gap: space[2] },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space[2] },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  idea: { borderRadius: radius.m, padding: 14, paddingLeft: space[4], flexDirection: 'row', alignItems: 'center', gap: space[3] },
});

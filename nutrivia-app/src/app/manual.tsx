import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { addManualMeal, ApiError, type DishHit } from '@/api/client';
import { AddDishSheet } from '@/components/add-dish-sheet';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { RoundButton } from '@/components/round-button';
import { Screen } from '@/components/screen';
import { Txt } from '@/components/txt';
import { compute, fmt, getDish, portionText } from '@/engine/engine';
import { refreshToday, useAppStore } from '@/store/app-store';
import { font, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

type Row = { dishId: string; name: string; grams: string };

/** Еда без фото: блюда из базы и граммы. Проверка не нужна — человек сам знает, что ел. */
export default function Manual() {
  const c = useColors();
  const { dispatch } = useAppStore();
  const { date, label } = useLocalSearchParams<{ date?: string; label?: string }>();
  const [rows, setRows] = useState<Row[]>([]);
  const [picking, setPicking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parsed = rows.map((r) => ({ ...r, g: Number(r.grams.replace(',', '.')) || 0 }));
  const kcal = parsed.reduce((sum, r) => sum + (r.g > 0 ? compute(getDish(r.dishId), r.g).kcal : 0), 0);
  const valid = parsed.length > 0 && parsed.every((r) => r.g > 0 && r.g <= 3000);

  function pick(d: DishHit) {
    setPicking(false);
    setRows((rs) => [...rs.filter((r) => r.dishId !== d.id), { dishId: d.id, name: d.name, grams: String(d.unit_grams || 100) }]);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await addManualMeal(parsed.map((r) => ({ dish_id: r.dishId, grams: r.g })), date);
      refreshToday(dispatch);
      if (router.canGoBack()) router.back();
      else router.replace("/today");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось сохранить. Попробуйте ещё раз.');
      setSaving(false);
    }
  }

  return (
    <Screen
      footer={
        <>
          {error && <Txt variant="caption" tone="warning">{error}</Txt>}
          <Button
            title={saving ? 'Сохраняем…' : rows.length ? `Записать · ${fmt(kcal)} ккал` : 'Записать'}
            block
            disabled={!valid || saving}
            onPress={save}
          />
        </>
      }>
      <RoundButton icon="back" label="Назад" onPress={() => router.back()} />
      <View style={{ gap: space[2] }}>
        <Txt variant="display">Без фото</Txt>
        <Txt tone="muted">
          {label ? `Запишем в ${label}. ` : ''}Выберите блюда и примерный вес — калории посчитаем по базе.
        </Txt>
      </View>

      <View style={{ gap: space[2] }}>
        {parsed.map((r, i) => (
          <View key={r.dishId} style={[styles.row, { backgroundColor: c.surface }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="headline" style={{ fontSize: 15 }} numberOfLines={1}>{r.name}</Txt>
              <Txt variant="caption" tone="muted">
                {r.g > 0 ? `${portionText(getDish(r.dishId), r.g)} · ${fmt(compute(getDish(r.dishId), r.g).kcal)} ккал` : 'Укажите вес'}
              </Txt>
            </View>
            <View style={[styles.grams, { backgroundColor: c.bg }]}>
              <TextInput
                value={r.grams}
                onChangeText={(v) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, grams: v.replace(/[^\d.,]/g, '').slice(0, 4) } : x)))}
                keyboardType="decimal-pad"
                accessibilityLabel={`Граммы: ${r.name}`}
                style={[styles.gramsInput, { color: c.ink }]}
              />
              <Txt variant="caption" tone="muted">г</Txt>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Убрать ${r.name}`}
              hitSlop={8}
              onPress={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
              <Icon name="close" size={18} color={c.muted} />
            </Pressable>
          </View>
        ))}
        <Pressable
          accessibilityRole="button"
          onPress={() => setPicking(true)}
          style={[styles.add, { borderColor: c.line }]}>
          <Icon name="plus" size={18} color={c.ink} />
          <Txt variant="headline" style={{ fontSize: 15 }}>{rows.length ? 'Ещё блюдо' : 'Выбрать блюдо'}</Txt>
        </Pressable>
      </View>

      <AddDishSheet visible={picking} onClose={() => setPicking(false)} onPick={pick} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], borderRadius: radius.m, paddingVertical: space[3], paddingHorizontal: space[4] },
  grams: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.s, paddingHorizontal: space[3], minHeight: 40 },
  gramsInput: { width: 52, fontFamily: font.bold, fontSize: 16, textAlign: 'right', paddingVertical: 6 },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2], minHeight: 52, borderRadius: radius.m, borderWidth: 1.5, borderStyle: 'dashed' },
});

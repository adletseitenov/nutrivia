import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { addManualMeal, type Advice } from '@/api/client';
import { Icon } from '@/components/icon';
import { Txt } from '@/components/txt';
import { fmt, getDish, portionText } from '@/engine/engine';
import { t } from '@/lib/i18n';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

/** «Совет на вечер»: 1–3 блюда из базы под остаток дня. Подбирает сервер (Engine), не модель. «+» записывает блюдо. */
export function AdviceCard({ advice, onAdded }: { advice: Advice; onAdded: () => void }) {
  const c = useColors();
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  if (!advice.options.length) return null;

  const evening = new Date().getHours() >= 16;
  const left = advice.remaining_kcal;
  const lead = advice.hint === 'protein' ? t('Белка пока немного — начните с белкового блюда.')
    : left <= 0 ? t('Ориентир на сегодня набран. Если хочется есть — вот лёгкие варианты.')
    : advice.hint === 'light' ? `${t('До ориентира')} ~${fmt(left)} ${t('ккал — подойдёт что-то лёгкое.')}`
    : `${t('До ориентира')} ~${fmt(left)} ${t('ккал. Например:')}`;

  async function add(id: string, grams: number) {
    setBusy(id);
    try {
      await addManualMeal([{ dish_id: id, grams }]);
      setAdded((a) => [...a, id]);
      onAdded();
    } catch {
      // сеть пропала — кнопка просто вернётся
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={[styles.card, { backgroundColor: c.accentTint }]}>
      <Txt variant="headline" tone="accent">{evening ? t('Совет на вечер') : t('Что съесть дальше')}</Txt>
      <Txt variant="caption">{lead}</Txt>
      {advice.options.map((o) => {
        const done = added.includes(o.dish_id);
        return (
          <View key={o.dish_id} style={[styles.row, { backgroundColor: c.bg }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="headline" style={{ fontSize: 15 }}>{o.name}</Txt>
              <Txt variant="caption" tone="muted">
                {portionText(getDish(o.dish_id), o.grams)} · {fmt(o.kcal)} {t('ккал')} · {t('белок')} {Math.round(o.protein)} {t('г')}
              </Txt>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={done ? `${t('Записано')}: ${o.name}` : `${t('Записать')}: ${o.name}`}
              disabled={done || busy !== null}
              onPress={() => add(o.dish_id, o.grams)}
              hitSlop={8}
              style={[styles.add, { backgroundColor: done ? c.surface : c.accent }]}>
              {busy === o.dish_id ? <ActivityIndicator color={c.onAccent} size="small" />
                : <Icon name={done ? 'check' : 'plus'} size={20} color={done ? c.accentText : c.onAccent} strokeWidth={2.25} />}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.m, padding: space[4], gap: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], borderRadius: radius.s, padding: space[3] },
  add: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});

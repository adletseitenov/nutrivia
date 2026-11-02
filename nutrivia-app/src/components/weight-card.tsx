import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';

import type { ServerWeights } from '@/api/client';
import { kgText } from '@/engine/engine';
import { dayLabel } from '@/lib/dates';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

import { Txt } from './txt';

const W = 300;
const H = 72;

/** Вес за 90 дней: последняя цифра, изменение и линия. Нажатие — записать вес. */
export function WeightCard({ data }: { data: ServerWeights | null }) {
  const c = useColors();
  const pts = data?.points ?? [];
  const last = pts[pts.length - 1];
  const min = Math.min(...pts.map((p) => p.kg));
  const max = Math.max(...pts.map((p) => p.kg));
  const span = Math.max(max - min, 1);
  const xy = pts.map((p, i) => [
    pts.length === 1 ? W / 2 : (i / (pts.length - 1)) * (W - 12) + 6,
    H - 6 - ((p.kg - min) / span) * (H - 12),
  ]);
  const change = data?.change ?? null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={last ? `Вес ${kgText(last.kg)} кг. Записать новый вес` : 'Записать вес'}
      onPress={() => router.push('/weight')}
      style={({ pressed }) => [styles.card, { backgroundColor: c.surface, opacity: pressed ? 0.85 : 1 }]}>
      <View style={styles.row}>
        <View style={{ gap: 2 }}>
          <Txt variant="caption" tone="muted">Вес</Txt>
          <Txt variant="numberM">{last ? `${kgText(last.kg)} кг` : '—'}</Txt>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          {change !== null && pts.length > 1 && (
            <Txt variant="caption" tone="muted">
              {change === 0 ? 'без изменений' : `${change > 0 ? '+' : '−'}${kgText(Math.abs(change))} кг с ${dayLabel(pts[0].date)}`}
            </Txt>
          )}
          <Txt variant="headline" tone="accent" style={{ fontSize: 15 }}>{last ? '+ Записать' : 'Записать вес'}</Txt>
        </View>
      </View>
      {pts.length > 1 ? (
        <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <Polyline points={xy.map((p) => p.join(',')).join(' ')} fill="none" stroke={c.blue} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          <Circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r={4.5} fill={c.blue} />
        </Svg>
      ) : (
        <Txt variant="caption" tone="muted">
          {last ? 'Взвешивайтесь раз в неделю в одно время — здесь появится линия.' : 'Запишите вес — по нему уточним ориентир калорий.'}
        </Txt>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.m, padding: space[4], gap: space[3] },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
});

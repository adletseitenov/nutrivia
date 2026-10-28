import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { fmt } from '@/engine/engine';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

import { Txt } from './txt';

function Arc({ size, stroke, value, color, track }: { size: number; stroke: number; value: number; color: string; track: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, value));
  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
      <Circle
        cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)}
      />
    </Svg>
  );
}

/** Кольцо «Осталось ккал». Сверх ориентира не красим и не оцениваем. */
export function CalorieRing({ consumed, target, size = 180 }: { consumed: number; target: number; size?: number }) {
  const c = useColors();
  const left = target - consumed;
  return (
    <View
      style={{ width: size, height: size }}
      accessible
      accessibilityLabel={`${left >= 0 ? 'Осталось' : 'Сверх ориентира'} ${fmt(Math.abs(left))} ккал из ${fmt(target)}`}>
      <Arc size={size} stroke={14} value={consumed / target} color={c.green} track={c.track} />
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Txt variant="numberXl">{fmt(Math.abs(left))}</Txt>
        <Txt variant="caption" tone="muted" center style={{ maxWidth: size - 48 }}>
          {left >= 0 ? 'Осталось ккал' : 'ккал сверх ориентира'}
        </Txt>
      </View>
    </View>
  );
}

const MACRO = { protein: 'Белки', carbs: 'Углеводы', fat: 'Жиры' } as const;
export type Macro = keyof typeof MACRO;

export function MacroCard({ macro, grams, target }: { macro: Macro; grams: number; target: number }) {
  const c = useColors();
  const color = { protein: c.macroProtein, carbs: c.macroCarbs, fat: c.macroFat }[macro];
  return (
    <View style={[styles.macro, { backgroundColor: c.surface }]}>
      <View>
        <Txt variant="numberM" numberOfLines={1}>{fmt(grams)} г</Txt>
        <Txt variant="caption" tone="muted" numberOfLines={1}>из {fmt(target)} г</Txt>
      </View>
      <Arc size={44} stroke={5} value={grams / target} color={color} track={c.track} />
      <Txt variant="caption" tone="muted">{MACRO[macro]}</Txt>
    </View>
  );
}

export function MacroDots({ protein, carbs, fat }: { protein: number; carbs: number; fat: number }) {
  const c = useColors();
  const items = [
    ['Б', protein, c.macroProtein],
    ['У', carbs, c.macroCarbs],
    ['Ж', fat, c.macroFat],
  ] as const;
  return (
    <View style={styles.dots}>
      {items.map(([l, v, color]) => (
        <View key={l} style={styles.dotItem}>
          <View style={[styles.dot, { backgroundColor: color }]} />
          <Txt variant="caption" tone="muted">{l} {fmt(v)}</Txt>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  macro: { flex: 1, borderRadius: radius.m, padding: space[4], gap: space[3], minWidth: 0 },
  dots: { flexDirection: 'row', gap: space[3], flexWrap: 'wrap' },
  dotItem: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  dot: { width: 8, height: 8, borderRadius: 4 },
});

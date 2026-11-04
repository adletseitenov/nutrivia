import { Image, type ImageSource } from 'expo-image';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useColors } from '@/theme/use-colors';

/**
 * Слот под маскота «Голубику» (рисует художник). Растёт по стадиям 1–5 от серии дней и заданий.
 * Когда придут файлы, положите их в assets/mascot/stage-N.png и пропишите здесь:
 *   1: require('@/assets/mascot/stage-1.png'), … — раскладка экранов не изменится.
 * Без стадии или без файла — нейтральный знак бренда: кольцо, заполненное на stage/5.
 */
export const MASCOT_STAGES: Partial<Record<number, ImageSource>> = {
  1: require('@/assets/mascot/stage-1.png'), // бутон
  2: require('@/assets/mascot/stage-2.png'), // белый бутон
  3: require('@/assets/mascot/stage-3.png'), // цветок
  4: require('@/assets/mascot/stage-4.png'), // розовая завязь
  5: require('@/assets/mascot/stage-5.png'), // голубика
};

const STAGES = 5;

/** Имена стадий — как у художника: росток → бутон → цветок → завязь → голубика. */
export const STAGE_NAMES = ['Росток', 'Бутон', 'Цветок', 'Завязь', 'Голубика'];

export function stageName(stage: number): string {
  return STAGE_NAMES[Math.min(STAGES, Math.max(1, stage)) - 1];
}

/** locked — стадия ещё не открыта: силуэт без цвета (тот же рисунок художника, только тоном). */
export function MascotSlot({ stage, size = 120, locked = false }: { stage?: number; size?: number; locked?: boolean }) {
  const c = useColors();
  const src = stage ? MASCOT_STAGES[stage] : undefined;
  const label = stage ? `Голубика, стадия ${stage} из ${STAGES}` : 'Nutrivia';
  if (src) {
    return (
      <Image
        source={src}
        style={{ width: size, height: size, opacity: locked ? 0.35 : 1 }}
        tintColor={locked ? c.muted : undefined}
        contentFit="contain"
        accessibilityLabel={locked ? `${label}, ещё не открыта` : label}
      />
    );
  }

  const stroke = Math.max(3, size * 0.09);
  const r = (size - stroke) / 2 - size * 0.06;
  const len = 2 * Math.PI * r;
  const frac = Math.min(1, Math.max(0.12, (stage ?? 1) / STAGES));
  return (
    <View accessible accessibilityLabel={label} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.accentTint }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.track} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.accent} strokeWidth={stroke} fill="none"
          strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - frac)} />
        <Circle cx={size / 2} cy={size / 2} r={size * 0.11} fill={c.accent} />
      </Svg>
    </View>
  );
}

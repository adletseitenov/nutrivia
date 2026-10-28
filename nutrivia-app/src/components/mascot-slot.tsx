import { Image, type ImageSource } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { useColors } from '@/theme/use-colors';

import { Txt } from './txt';

/**
 * Слот под маскота. Маскот растёт по стадиям (1–5) от серии дней и заданий.
 * Когда появятся файлы mascot-stage-N, передайте их в MASCOT_STAGES — раскладка не изменится.
 */
export const MASCOT_STAGES: Partial<Record<number, ImageSource>> = {};

export function MascotSlot({ stage, size = 120 }: { stage?: number; size?: number }) {
  const c = useColors();
  const src = stage ? MASCOT_STAGES[stage] : undefined;
  if (src) return <Image source={src} style={{ width: size, height: size }} contentFit="contain" accessibilityLabel={`Маскот, стадия ${stage}`} />;
  return (
    <View
      accessibilityLabel="Место для маскота"
      style={[styles.empty, { width: size, height: size, borderRadius: size / 2, backgroundColor: c.surface, borderColor: c.line }]}>
      <Txt variant="caption" tone="muted">{stage ? `Стадия ${stage}` : 'Маскот'}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
});

import { Image, type ImageSource } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { useColors } from '@/theme/use-colors';
import { t } from '@/lib/i18n';

import { Txt } from './txt';

/**
 * Слот под маскота «Голубику» (рисует художник). Растёт по стадиям 1–5 от серии дней и заданий.
 * Когда придут файлы, положите их в assets/mascot/stage-N.png и пропишите здесь:
 *   1: require('@/assets/mascot/stage-1.png'), … — раскладка экранов не изменится.
 */
export const MASCOT_STAGES: Partial<Record<number, ImageSource>> = {};

export function MascotSlot({ stage, size = 120 }: { stage?: number; size?: number }) {
  const c = useColors();
  const src = stage ? MASCOT_STAGES[stage] : undefined;
  if (src) return <Image source={src} style={{ width: size, height: size }} contentFit="contain" accessibilityLabel={`Маскот, стадия ${stage}`} />;
  return (
    <View
      accessibilityLabel={t('Место для маскота')}
      style={[styles.empty, { width: size, height: size, borderRadius: size / 2, backgroundColor: c.accentTint, borderColor: c.accent }]}>
      <Txt variant="caption" tone="accent" center>{stage ? `Голубика\nстадия ${stage}` : 'Голубика'}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
});

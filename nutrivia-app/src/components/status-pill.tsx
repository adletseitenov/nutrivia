import { StyleSheet, View } from 'react-native';

import { radius } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

import { Icon } from './icon';
import { Txt } from './txt';

export type MealStatus = 'draft' | 'reviewed' | 'needs-info';

const LABELS: Record<MealStatus, string> = {
  draft: 'Оценка по фото',
  reviewed: 'Проверено нутрициологом',
  'needs-info': 'Уточните блюдо',
};

/** Подпись «проверено» по тому, кто проверял: тренер — «тренером», остальные — «нутрициологом». */
export function reviewedLabel(role?: string | null) {
  return role === 'trainer' ? 'Проверено тренером' : undefined;
}

/** Статус разбора: у каждого есть слово, смысл не держится только на цвете. */
export function StatusPill({ status, label }: { status: MealStatus; label?: string }) {
  const c = useColors();
  const bg = status === 'reviewed' ? c.greenTint : c.surface;
  const fg = { draft: c.muted, reviewed: c.greenText, 'needs-info': c.warning }[status];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      {status === 'reviewed' ? (
        <Icon name="check" size={12} color={fg} strokeWidth={2.4} />
      ) : (
        <View style={[styles.dot, { backgroundColor: fg }]} />
      )}
      <Txt variant="label" style={{ color: fg }} numberOfLines={1}>
        {label ?? LABELS[status]}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3 },
});

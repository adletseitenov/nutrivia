import { Pressable, StyleSheet, View } from 'react-native';

import { fmt } from '@/engine/engine';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

import { MealPhoto } from './meal-photo';
import { MacroDots } from './rings';
import { reviewedLabel, StatusPill, type MealStatus } from './status-pill';
import { Txt } from './txt';

type Props = {
  title: string;
  time: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  photo?: string | null;
  status: MealStatus;
  reviewerRole?: string | null;
  onPress?: () => void;
};

export function MealCard({ title, time, kcal, protein, carbs, fat, photo, status, reviewerRole, onPress }: Props) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, { backgroundColor: c.surface, opacity: pressed ? 0.85 : 1 }]}>
      <MealPhoto uri={photo} width={64} height={64} radius={radius.s} />
      <View style={styles.body}>
        <View style={styles.top}>
          <Txt variant="headline" numberOfLines={1} style={{ flex: 1 }}>{title}</Txt>
          <Txt variant="caption" tone="muted">{time}</Txt>
        </View>
        <Txt variant="headline" style={{ fontSize: 15, lineHeight: 20 }}>{fmt(kcal)} ккал</Txt>
        <View style={styles.foot}>
          <MacroDots protein={protein} carbs={carbs} fat={fat} />
          <StatusPill status={status} label={status === 'reviewed' ? reviewedLabel(reviewerRole) : undefined} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: space[3], alignItems: 'center', padding: space[3], borderRadius: radius.m },
  body: { flex: 1, minWidth: 0, gap: 2 },
  top: { flexDirection: 'row', alignItems: 'baseline', gap: space[2] },
  foot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space[2], flexWrap: 'wrap', marginTop: space[1] },
});

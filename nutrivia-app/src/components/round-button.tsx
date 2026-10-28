import { Pressable } from 'react-native';

import { useColors } from '@/theme/use-colors';

import { Icon, type IconName } from './icon';

/** Круглая кнопка-иконка 44×44: назад, закрыть, поиск. */
export function RoundButton({ icon, label, onPress, tone = 'surface' }: {
  icon: IconName; label: string; onPress?: () => void; tone?: 'surface' | 'ink' | 'glass';
}) {
  const c = useColors();
  const bg = { surface: c.surface, ink: c.ink, glass: 'rgba(255,255,255,0.16)' }[tone];
  const fg = { surface: c.ink, ink: c.onInk, glass: '#FFFFFF' }[tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
      <Icon name={icon} size={20} color={fg} />
    </Pressable>
  );
}

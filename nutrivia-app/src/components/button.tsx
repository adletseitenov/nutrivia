import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, type PressableProps, type ViewStyle } from 'react-native';

import { font, radius } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

import { Txt } from './txt';

type Props = Omit<PressableProps, 'style'> & {
  title: string;
  /** primary — одна чёрная на экран; secondary — серая; accent — зелёная («Верно», камера) */
  variant?: 'primary' | 'secondary' | 'accent';
  size?: 's' | 'm';
  block?: boolean;
  style?: ViewStyle;
};

export function Button({ title, variant = 'primary', size = 'm', block, style, onPress, disabled, ...rest }: Props) {
  const c = useColors();
  const bg = { primary: c.ink, secondary: c.surface, accent: c.green }[variant];
  const fg = { primary: c.onInk, secondary: c.ink, accent: c.onGreen }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={(e) => {
        Haptics.selectionAsync();
        onPress?.(e);
      }}
      style={({ pressed }) => [
        styles.base,
        size === 's' ? styles.small : styles.medium,
        { backgroundColor: bg, opacity: disabled ? 0.4 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
        block && { alignSelf: 'stretch' },
        style,
      ]}
      {...rest}>
      <Txt style={{ color: fg, fontFamily: font.semibold, fontSize: size === 's' ? 15 : 17 }} numberOfLines={1}>
        {title}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  medium: { minHeight: 52, paddingHorizontal: 24 },
  small: { minHeight: 40, paddingHorizontal: 16 },
});

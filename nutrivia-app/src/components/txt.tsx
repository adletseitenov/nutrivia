import { Text, type TextProps } from 'react-native';

import { type, type TypeVariant } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

type Props = TextProps & {
  variant?: TypeVariant;
  /** muted — подписи и единицы; accent — акцентный текст (фиолетовый, контрастный к фону) */
  tone?: 'ink' | 'muted' | 'accent' | 'onInk' | 'warning';
  center?: boolean;
};

export function Txt({ variant = 'body', tone = 'ink', center, style, ...rest }: Props) {
  const c = useColors();
  const color = { ink: c.ink, muted: c.muted, accent: c.accentText, onInk: c.onInk, warning: c.warning }[tone];
  return (
    <Text
      {...rest}
      style={[type[variant], { color, fontVariant: ['tabular-nums'] }, center && { textAlign: 'center' }, style]}
    />
  );
}

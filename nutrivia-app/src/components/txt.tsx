import { Text, type TextProps } from 'react-native';

import { type, type TypeVariant } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

type Props = TextProps & {
  variant?: TypeVariant;
  /** muted — подписи и единицы; green — только зелёный текст на светлом фоне */
  tone?: 'ink' | 'muted' | 'green' | 'onInk' | 'warning';
  center?: boolean;
};

export function Txt({ variant = 'body', tone = 'ink', center, style, ...rest }: Props) {
  const c = useColors();
  const color = { ink: c.ink, muted: c.muted, green: c.greenText, onInk: c.onInk, warning: c.warning }[tone];
  return (
    <Text
      {...rest}
      style={[type[variant], { color, fontVariant: ['tabular-nums'] }, center && { textAlign: 'center' }, style]}
    />
  );
}

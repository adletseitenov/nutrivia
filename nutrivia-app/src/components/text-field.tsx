import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { font, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

import { Txt } from './txt';

type Props = TextInputProps & { label: string; prefix?: string; error?: string | null; big?: boolean };

/** Поле ввода: подпись сверху, заливка surface, ошибка снизу цветом warning. */
export function TextField({ label, prefix, error, big, style, ...rest }: Props) {
  const c = useColors();
  const size = big ? { fontSize: 28, lineHeight: 34, fontFamily: font.bold } : { fontSize: 17, lineHeight: 24, fontFamily: font.medium };
  return (
    <View style={{ gap: space[2] }}>
      <Txt variant="caption" tone="muted">{label}</Txt>
      <View style={[styles.box, { backgroundColor: c.surface, borderColor: error ? c.warning : 'transparent' }]}>
        {prefix && <Txt style={[size, { color: c.ink }]}>{prefix}</Txt>}
        <TextInput
          placeholderTextColor={c.muted}
          accessibilityLabel={label}
          style={[styles.input, size, { color: c.ink }, style]}
          {...rest}
        />
      </View>
      {error ? <Txt variant="caption" tone="warning">{error}</Txt> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: space[2], borderRadius: radius.m, borderWidth: 1.5, paddingHorizontal: space[4], minHeight: 60 },
  input: { flex: 1, paddingVertical: space[3], fontVariant: ['tabular-nums'] },
});

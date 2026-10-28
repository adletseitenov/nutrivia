import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

/** Экран с полями space-5 и отступом под системные панели. `tabs` — оставить место под нижнюю панель. */
export function Screen({ children, scroll = true, tabs, style, footer }: {
  children: ReactNode; scroll?: boolean; tabs?: boolean; style?: ViewStyle; footer?: ReactNode;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const pad = { paddingTop: insets.top + space[3], paddingBottom: tabs ? 120 : insets.bottom + space[4] };
  const content = [styles.content, pad, style];
  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      {scroll ? (
        <ScrollView contentContainerStyle={content} showsVerticalScrollIndicator={false}>{children}</ScrollView>
      ) : (
        <View style={[content, { flex: 1 }]}>{children}</View>
      )}
      {footer && <View style={[styles.footer, { paddingBottom: insets.bottom + space[3], backgroundColor: c.bg }]}>{footer}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: space[5], gap: space[5] },
  footer: { paddingHorizontal: space[5], paddingTop: space[3], gap: space[3] },
});

import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { font } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';
import { t } from '@/lib/i18n';

import { Icon, type IconName } from './icon';
import { Txt } from './txt';

const TABS: Record<string, { label: string; icon: IconName }> = {
  today: { label: 'Сегодня', icon: 'home' },
  feed: { label: 'Лента', icon: 'people' },
  progress: { label: 'Прогресс', icon: 'chart' },
  profile: { label: 'Профиль', icon: 'user' },
};

/** Нижняя панель: 4 вкладки и фиолетовая кнопка камеры по центру. */
export function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { backgroundColor: c.surfaceRaised, paddingBottom: Math.max(insets.bottom, 12) }]}>
      {state.routes.map((route, index) => {
        if (route.name === 'capture') {
          return (
            <View key={route.key} style={styles.item}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Сфотографировать еду')}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.push('/camera');
                }}
                style={({ pressed }) => [styles.camera, { backgroundColor: c.accent, transform: [{ scale: pressed ? 0.95 : 1 }] }]}>
                <Icon name="camera" size={28} color={c.onAccent} strokeWidth={2} />
              </Pressable>
            </View>
          );
        }
        const tab = TABS[route.name];
        if (!tab) return null;
        const focused = state.index === index;
        const color = focused ? c.ink : c.muted;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            onPress={() => {
              if (!focused) navigateToTab(route.key);
            }}
            style={styles.item}>
            <Icon name={tab.icon} color={color} />
            <Txt style={{ color, fontFamily: focused ? font.semibold : font.medium, fontSize: 11, lineHeight: 14 }}>{t(tab.label)}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', paddingTop: 10, paddingHorizontal: 12,
    shadowColor: '#0E0C16', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: -8 }, elevation: 12,
  },
  item: { flex: 1, alignItems: 'center', gap: 2, minHeight: 44, justifyContent: 'center' },
  camera: {
    width: 60, height: 60, borderRadius: 30, marginTop: -30, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#6B4EFF', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
});

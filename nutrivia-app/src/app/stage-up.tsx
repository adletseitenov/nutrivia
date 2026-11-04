import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { Button } from '@/components/button';
import { MascotSlot, stageName } from '@/components/mascot-slot';
import { Screen } from '@/components/screen';
import { Txt } from '@/components/txt';
import { daysWord } from '@/lib/dates';
import { t } from '@/lib/i18n';
import { font, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

/** «Голубика выросла»: показываем один раз, когда серия открыла новую стадию (см. useStageUp на «Сегодня»). */
export default function StageUp() {
  const c = useColors();
  const p = useLocalSearchParams<{ stage: string; days: string }>();
  const stage = Math.min(5, Math.max(2, Number(p.stage) || 2));
  const days = Number(p.days) || 0;

  const grow = useSharedValue(0.4);
  const fade = useSharedValue(0);
  const glow = useSharedValue(0.9);
  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    grow.value = withSpring(1, { damping: 9, stiffness: 120 });
    fade.value = withDelay(250, withTiming(1, { duration: 400 }));
    glow.value = withRepeat(withSequence(
      withTiming(1.08, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
      withTiming(0.9, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
    ), -1);
  }, [grow, fade, glow]);
  const mascot = useAnimatedStyle(() => ({ transform: [{ scale: grow.value }] }));
  const halo = useAnimatedStyle(() => ({ transform: [{ scale: glow.value }], opacity: fade.value }));
  const text = useAnimatedStyle(() => ({ opacity: fade.value, transform: [{ translateY: (1 - fade.value) * 12 }] }));

  return (
    <Screen scroll={false} style={{ justifyContent: 'center' }}
      footer={<Button title={t('Дальше')} variant="accent" block onPress={() => router.back()} />}>
      <View style={{ alignItems: 'center', gap: space[5], flex: 1, justifyContent: 'center' }}>
        <View style={styles.stageBox}>
          <Animated.View style={[styles.halo, { backgroundColor: c.accentTint }, halo]} />
          <Animated.View style={mascot}>
            <MascotSlot stage={stage} size={220} />
          </Animated.View>
        </View>
        <Animated.View style={[{ alignItems: 'center', gap: space[2] }, text]}>
          <Txt variant="label" tone="accent">{t('Новая стадия')} · {stage} {t('из')} 5</Txt>
          <Txt center style={{ fontFamily: font.extrabold, fontSize: 32, lineHeight: 38, letterSpacing: -0.5 }}>
            {t('Голубика выросла')}: {t(stageName(stage)).toLowerCase()}
          </Txt>
          <Txt variant="caption" tone="muted" center style={{ fontSize: 15, lineHeight: 21 }}>
            {days ? `${days} ${daysWord(days)} ${t('подряд с фото еды.')} ` : ''}
            {stage < 5 ? t('Продолжайте — следующая стадия уже ближе.') : t('Это последняя стадия. Вы вырастили голубику!')}
          </Txt>
        </Animated.View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stageBox: { width: 280, height: 280, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 260, height: 260, borderRadius: 130 },
});

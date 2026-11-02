import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';

import { claimPayment, getSubscription, type Subscription } from '@/api/client';
import { Button } from '@/components/button';
import { RoundButton } from '@/components/round-button';
import { Screen } from '@/components/screen';
import { Txt } from '@/components/txt';
import { fmt } from '@/engine/engine';
import { dayLabel, daysWord } from '@/lib/dates';
import { t } from '@/lib/i18n';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

const WHAT = [
  'Проверка каждого разбора нутрициологом',
  'Личный ориентир калорий и белка',
  'Холодильник: что приготовить под остаток дня',
  'Итог недели от специалиста',
];

/** Подписка: пробный период → оплата Kaspi по ссылке → «Я оплатил» → команда подтверждает. */
export default function SubscriptionScreen() {
  const c = useColors();
  const [s, setS] = useState<Subscription | null>(null);

  useFocusEffect(
    useCallback(() => {
      getSubscription().then(setS, () => {});
    }, []),
  );

  const title = !s ? '' : s.status === 'active' ? t('Подписка активна')
    : s.status === 'trial' ? `${t('Пробный период')}: ${s.days_left} ${daysWord(s.days_left ?? 0)}`
    : s.status === 'free' ? t('Для специалистов бесплатно') : t('Пробный период закончился');

  return (
    <Screen>
      <RoundButton icon="back" label={t('Назад')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/profile'))} />
      {!s ? <ActivityIndicator color={c.ink} /> : (
        <>
          <View style={{ gap: space[2] }}>
            <Txt variant="display">{t('Подписка')}</Txt>
            <Txt tone="muted">{title}{s.status === 'active' && s.until ? ` · ${t('до')} ${dayLabel(s.until)}` : ''}</Txt>
          </View>

          <View style={[styles.card, { backgroundColor: c.surface }]}>
            <Txt variant="numberM">{fmt(s.price_kzt)} ₸ <Txt variant="caption" tone="muted">{t('в месяц')}</Txt></Txt>
            {WHAT.map((w) => <Txt key={w} variant="caption">✓ {t(w)}</Txt>)}
          </View>

          {s.status !== 'free' && (
            s.pending ? (
              <View style={[styles.card, { backgroundColor: c.accentTint }]}>
                <Txt variant="headline" tone="accent">{t('Оплата на проверке')}</Txt>
                <Txt variant="caption">{t('Команда сверит перевод и продлит подписку — обычно в течение дня.')}</Txt>
              </View>
            ) : (
              <View style={{ gap: space[3] }}>
                {s.pay_url && (
                  <Button title={`${t('Оплатить в Kaspi')} · ${fmt(s.price_kzt)} ₸`} variant="accent" block
                    onPress={() => Linking.openURL(s.pay_url!)} />
                )}
                <Button title={t('Я оплатил')} variant="secondary" block onPress={() => claimPayment().then(setS, () => {})} />
                <Txt variant="caption" tone="muted">
                  {s.pay_url
                    ? t('После перевода нажмите «Я оплатил» — команда сверит платёж и продлит подписку на 30 дней.')
                    : t('Ссылка на оплату появится скоро. Пока можно написать команде Nutrivia в WhatsApp.')}
                </Txt>
              </View>
            )
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.m, padding: space[4], gap: space[2] },
});

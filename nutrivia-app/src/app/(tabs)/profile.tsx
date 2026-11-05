import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, View } from 'react-native';

import { bodyFromMe, deleteMe, exportMe, getMe, getSubscription, logout, patchLang, type Subscription } from '@/api/client';
import { Icon } from '@/components/icon';
import { Screen } from '@/components/screen';
import { Txt } from '@/components/txt';
import { fmt, kgText } from '@/engine/engine';
import { REMINDERS_SUPPORTED, remindersOn, setReminders } from '@/lib/reminders';
import { GOALS, useAppStore, useTargets } from '@/store/app-store';
import { font, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';
import { FEATURES } from '@/lib/features';
import { getLang, setLang, t } from '@/lib/i18n';
import { useTelegram } from '@/lib/use-telegram';

export default function Profile() {
  const c = useColors();
  const { state, dispatch } = useAppStore();
  const tg = useTargets();
  const goal = GOALS.find((g) => g.id === state.goal)!;
  const body = bodyFromMe(state.me);
  const [reminders, setRemindersState] = useState<boolean | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  useEffect(() => {
    getSubscription().then(setSubscription, () => {});
  }, []);
  const sub = !subscription ? '…' : subscription.status === 'active' ? t('Активна')
    : subscription.status === 'trial' ? `${t('Пробный')}: ${subscription.days_left} ${t('дн.')}` : t('Закончилась');

  async function downloadData() {
    try {
      const json = await exportMe();
      if (Platform.OS === 'web') {
        const a = Object.assign(document.createElement('a'), {
          href: URL.createObjectURL(new Blob([json], { type: 'application/json' })),
          download: 'nutrivia-my-data.json',
        });
        a.click();
      } else {
        await Share.share({ message: json, title: 'Мои данные Nutrivia' });
      }
    } catch {
      // нет связи — человек нажмёт ещё раз
    }
  }

  useEffect(() => {
    if (REMINDERS_SUPPORTED) remindersOn().then(setRemindersState, () => setRemindersState(false));
  }, []);

  const telegram = state.me?.telegram;
  const refreshMe = useCallback(() => getMe().then((me) => dispatch({ type: 'setMe', me }), () => {}), [dispatch]);
  const onTelegram = useTelegram(telegram, (me) => dispatch({ type: 'setMe', me }), refreshMe);

  const rows: { label: string; value: string; onPress?: () => void }[] = [
    { label: 'Цель', value: goal.title, onPress: () => router.push('/goal') },
    {
      label: 'Параметры',
      value: body ? `${body.heightCm} см · ${kgText(body.weightKg)} кг` : 'Указать',
      onPress: () => router.push('/body'),
    },
    ...(state.me?.role === 'client' ? [{ label: 'Подписка', value: sub, onPress: () => router.push('/subscription') }] : []),
    { label: 'Ориентир на день', value: `${fmt(tg.kcal)} ккал${state.me?.targets?.set_by_pro ? ' · от специалиста' : ''}` },
    state.me?.coach
      ? { label: 'Тренер или нутрициолог', value: state.me.coach.name }
      : { label: 'Тренер или нутрициолог', value: 'Ввести код', onPress: () => router.push('/join') },
    ...(FEATURES.kazakh
      ? [{
          label: t('Язык'),
          value: getLang() === 'kk' ? 'Қазақша' : 'Русский',
          onPress: () => {
            const next = getLang() === 'kk' ? 'ru' : 'kk';
            patchLang(next).then((me) => dispatch({ type: 'setMe', me }), () => {});
            setLang(next);
          },
        }]
      : []),
    ...(telegram?.available && state.me?.role === 'client'
      ? [{
          label: 'Уведомления в Telegram',
          value: telegram.linked ? 'Подключены' : 'Подключить',
          onPress: onTelegram,
        }]
      : []),
    ...(REMINDERS_SUPPORTED
      ? [{
          label: 'Напоминания о еде',
          value: reminders === null ? '…' : reminders ? '9:00 · 13:30 · 19:00' : 'Выключены',
          onPress: () => setReminders(!reminders).then(setRemindersState, () => {}),
        }]
      : []),
  ];

  return (
    <Screen tabs>
      <Txt variant="title" style={{ fontFamily: font.extrabold, fontSize: 28, lineHeight: 34 }}>{t('Профиль')}</Txt>
      <View style={[styles.group, { backgroundColor: c.surface }]}>
        {rows.map((r, i) => (
          <Pressable
            key={r.label}
            onPress={r.onPress}
            disabled={!r.onPress}
            accessibilityRole={r.onPress ? 'button' : undefined}
            style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}>
            <Txt variant="caption" tone="muted" style={{ fontSize: 15 }}>{t(r.label)}</Txt>
            <View style={styles.value}>
              <Txt variant="headline" style={{ fontSize: 15 }} numberOfLines={1}>{t(r.value)}</Txt>
              {r.onPress && (
                <View style={{ transform: [{ rotate: '180deg' }] }}>
                  <Icon name="back" size={16} color={c.muted} />
                </View>
              )}
            </View>
          </Pressable>
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={async () => {
          await logout().catch(() => {});
          dispatch({ type: 'reset' });
          router.replace('/welcome');
        }}
        style={[styles.danger, { backgroundColor: c.surface }]}>
        <Txt variant="headline" style={{ fontSize: 15 }}>{t('Выйти')}</Txt>
      </Pressable>
      <View style={[styles.group, { backgroundColor: c.surface }]}>
        {([
          ['Мои данные', 'Скачать', downloadData],
          ['Конфиденциальность', '', () => router.push({ pathname: '/legal', params: { doc: 'privacy' } })],
          ['Условия использования', '', () => router.push({ pathname: '/legal', params: { doc: 'terms' } })],
        ] as const).map(([label, value, onPress], i) => (
          <Pressable key={label} accessibilityRole="button" onPress={onPress}
            style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}>
            <Txt style={{ fontSize: 15 }}>{t(label)}</Txt>
            <Txt variant="caption" tone="muted">{value ? t(value) : '›'}</Txt>
          </Pressable>
        ))}
      </View>
      <Txt variant="caption" tone="muted">
        {t('Удалить аккаунт и все фото можно в любой момент — данные стираются с сервера полностью.')}
      </Txt>
      <Pressable
        accessibilityRole="button"
        onPress={async () => {
          try {
            await deleteMe();
          } catch {
            return; // нет связи — данные не удалены, ничего не сбрасываем
          }
          dispatch({ type: 'reset' });
          router.replace('/welcome');
        }}
        style={[styles.danger, { backgroundColor: c.surface }]}>
        <Txt variant="headline" tone="warning" style={{ fontSize: 15 }}>{t('Удалить мои данные')}</Txt>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { borderRadius: radius.m, overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space[4], minHeight: 52, gap: space[3] },
  value: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  danger: { borderRadius: radius.m, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
});

import { useEffect, useState } from 'react';
import { Alert, AppState, Linking, Platform } from 'react-native';

import { telegramLink, telegramUnlink, type Me } from '@/api/client';
import { t } from '@/lib/i18n';

/** Ссылка на бота живёт 15 минут — берём с запасом. */
const linkFresh = (at: number) => Date.now() - at < 14 * 60 * 1000;

/**
 * Привязка Telegram (профиль клиента, кабинет специалиста). Ссылку берём заранее: открыть её надо прямо в нажатии,
 * иначе Safari сочтёт это всплывающим окном. onMe — новый профиль после отвязки; refresh — перечитать профиль,
 * когда человек вернулся из Telegram после «Старт».
 */
export function useTelegram(telegram: Me['telegram'], onMe: (me: Me) => void, refresh: () => void) {
  const [link, setLink] = useState<{ url: string; at: number } | null>(null);
  const fetchLink = () => telegramLink().then((r) => setLink({ url: r.url, at: Date.now() }), () => {});

  useEffect(() => {
    if (telegram?.available && !telegram.linked) fetchLink();
  }, [telegram?.available, telegram?.linked]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refresh(); });
    return () => sub.remove();
  }, [refresh]);

  return function onPress() {
    if (telegram?.linked) {
      const off = () => telegramUnlink().then(onMe, () => {});
      if (Platform.OS === 'web') {
        if (window.confirm(t('Отключить уведомления в Telegram?'))) off();
      } else {
        Alert.alert(t('Отключить уведомления в Telegram?'), '', [
          { text: t('Отмена'), style: 'cancel' },
          { text: t('Отключить'), style: 'destructive', onPress: off },
        ]);
      }
      return;
    }
    if (link && linkFresh(link.at)) {
      Linking.openURL(link.url);
      setLink(null);
      fetchLink(); // ссылка одноразовая — сразу следующая
    } else {
      telegramLink().then((r) => Linking.openURL(r.url), () => {});
    }
  };
}

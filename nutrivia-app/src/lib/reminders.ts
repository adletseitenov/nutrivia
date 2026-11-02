/**
 * Напоминания о еде: локальные уведомления на телефоне, без сервера и пушей.
 * Включены = на телефоне запланированы ежедневные напоминания с нашими id.
 * В браузере не работают — переключатель там не показываем.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export const REMINDERS_SUPPORTED = Platform.OS !== 'web';

const MEALS = [
  { id: 'nutrivia-breakfast', hour: 9, minute: 0, body: 'Сфотографируйте завтрак — разбор придёт сразу.' },
  { id: 'nutrivia-lunch', hour: 13, minute: 30, body: 'Обед уже был? Снимите тарелку до того, как начнёте.' },
  { id: 'nutrivia-dinner', hour: 19, minute: 0, body: 'Не забудьте ужин — так день засчитается в серию.' },
];

if (REMINDERS_SUPPORTED) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

export async function remindersOn(): Promise<boolean> {
  if (!REMINDERS_SUPPORTED) return false;
  const all = await Notifications.getAllScheduledNotificationsAsync();
  return MEALS.every((m) => all.some((n) => n.identifier === m.id));
}

/** Включить или выключить. Возвращает итоговое состояние (false, если человек не дал разрешение). */
export async function setReminders(on: boolean): Promise<boolean> {
  if (!REMINDERS_SUPPORTED) return false;
  await Promise.all(MEALS.map((m) => Notifications.cancelScheduledNotificationAsync(m.id).catch(() => {})));
  if (!on) return false;
  const perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return false;
  for (const m of MEALS) {
    await Notifications.scheduleNotificationAsync({
      identifier: m.id,
      content: { title: 'Nutrivia', body: m.body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: m.hour, minute: m.minute },
    });
  }
  return true;
}

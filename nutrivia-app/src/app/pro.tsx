import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Share, StyleSheet, View } from 'react-native';

import {
  ApiError, getModeration, getQueue, getStudents, logout, moderatePost, type Me, type Post, type ProMeal, type Student,
} from '@/api/client';
import { Button } from '@/components/button';
import { MealCard } from '@/components/meal-card';
import { Screen } from '@/components/screen';
import { StatusPill } from '@/components/status-pill';
import { Txt } from '@/components/txt';
import { fmt } from '@/engine/engine';
import { daysWord } from '@/lib/dates';
import { itemsFromServer, mealNutrients, useAppStore } from '@/store/app-store';
import { font, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';
import { t } from '@/lib/i18n';

/**
 * Кабинет тренера, нутрициолога или оператора Nutrivia: очередь разборов на проверку и клиенты за сегодня.
 * У тренера и нутрициолога ещё код приглашения для учеников.
 */
/** «ждёт 12 мин» — специалист видит, сколько клиент уже ждёт (обещание — 15 минут) */
function waitLabel(ts?: number) {
  const min = Math.max(0, Math.round((Date.now() / 1000 - (ts ?? 0)) / 60));
  if (min < 1) return 'только что';
  if (min < 60) return `ждёт ${min} мин`;
  return `ждёт ${Math.floor(min / 60)} ч`;
}

export default function Pro() {
  const c = useColors();
  const { dispatch } = useAppStore();
  const [data, setData] = useState<{ students: Student[]; me: Me } | null>(null);
  const [queue, setQueue] = useState<ProMeal[]>([]);
  const [reported, setReported] = useState<Post[]>([]);
  const [error, setError] = useState<string | null>(null);

  // При каждом возвращении в кабинет — свежие ученики и очередь; пока открыт — раз в 20 секунд
  useFocusEffect(
    useCallback(() => {
      const load = () => {
        getStudents().then(
          (r) => { setData(r); setError(null); },
          (e) => setError(e instanceof ApiError ? e.message : 'Не получилось загрузить учеников.'),
        );
        getQueue().then((r) => setQueue(r.meals), () => {});
        // Модерация ленты — только у оператора; специалисту сервер ответит 403, это нормально
        getModeration().then((r) => setReported(r.posts), () => setReported([]));
      };
      load();
      const timer = setInterval(load, 20000);
      return () => clearInterval(timer);
    }, []),
  );

  const pro = data?.me.pro;
  const isTrainer = data?.me.role === 'trainer';
  const isOperator = !!pro?.operator;

  async function share() {
    if (!pro?.invite_code) return;
    await Share.share({
      message: `Веду питание в Nutrivia. Установите приложение и при регистрации введите мой код: ${pro.invite_code}`,
    });
  }

  async function signOut() {
    await logout().catch(() => {});
    dispatch({ type: 'reset' });
    router.replace('/welcome');
  }

  return (
    <Screen>
      <View>
        <Txt variant="caption" tone="muted">{isOperator ? 'Кабинет оператора' : isTrainer ? 'Кабинет тренера' : 'Кабинет нутрициолога'}</Txt>
        <Txt variant="title" style={{ fontFamily: font.extrabold, fontSize: 28, lineHeight: 34 }}>{pro?.name ?? '…'}</Txt>
      </View>

      {!data && !error && <ActivityIndicator color={c.ink} style={{ marginTop: space[6] }} />}
      {error && <Txt tone="warning">{error}</Txt>}

      {pro && (
        <>
          {!isOperator && (
            <View style={[styles.codeCard, { backgroundColor: c.ink }]}>
              <Txt variant="caption" style={{ color: c.onInk, opacity: 0.7 }}>{t('Ваш код для учеников')}</Txt>
              <Txt style={{ fontFamily: font.extrabold, fontSize: 40, lineHeight: 46, letterSpacing: 4, color: c.onInk }} selectable>
                {pro.invite_code}
              </Txt>
              <Txt variant="caption" style={{ color: c.onInk, opacity: 0.7 }}>
                {pro.limit !== null
                  ? `Учеников: ${pro.students} из ${pro.limit}`
                  : `Учеников: ${pro.students}`}
              </Txt>
              <Button title={t('Отправить код')} variant="accent" onPress={share} style={{ alignSelf: 'flex-start', marginTop: space[2] }} />
            </View>
          )}

          <View style={{ gap: space[3] }}>
            <View style={styles.row}>
              <Txt variant="title" style={{ fontSize: 20, lineHeight: 26 }}>{t('Ждут проверки')}</Txt>
              {queue.length > 0 && <Txt variant="caption" tone="muted">{queue.length}</Txt>}
            </View>
            {queue.length === 0 ? (
              <Txt variant="caption" tone="muted">{t('Все разборы проверены.')}</Txt>
            ) : (
              queue.map((m) => {
                const items = itemsFromServer(m.items);
                const n = mealNutrients(items);
                return (
                  <MealCard
                    key={m.id}
                    title={`${m.student}: ${items.map((i) => i.name).join(', ').toLowerCase()}`}
                    time={waitLabel(m.received_at)}
                    kcal={n.kcal}
                    protein={n.protein}
                    carbs={n.carbs}
                    fat={n.fat}
                    photo={m.has_photo ? `pro:${m.id}` : null}
                    status={items.some((i) => !i.dishId) ? 'needs-info' : 'draft'}
                    onPress={() => router.push({ pathname: '/pro-review', params: { id: String(m.id) } })}
                  />
                );
              })
            )}
          </View>

          {isOperator && reported.length > 0 && (
            <View style={{ gap: space[3] }}>
              <Txt variant="title" style={{ fontSize: 20, lineHeight: 26 }}>Жалобы в ленте</Txt>
              {reported.map((p) => (
                <View key={p.id} style={[styles.student, { backgroundColor: c.surface }]}>
                  <View style={styles.row}>
                    <Txt variant="caption" tone="muted">{p.author} · {p.at}</Txt>
                    <Txt variant="caption" tone="warning">{p.hidden ? 'скрыт · ' : ''}жалоб: {p.reports}</Txt>
                  </View>
                  <Txt style={{ fontSize: 15, lineHeight: 22 }}>{p.text}</Txt>
                  <View style={styles.row}>
                    <Button title="Оставить" variant="secondary" size="s"
                      onPress={() => moderatePost(p.id, true).then(() => setReported((r) => r.filter((x) => x.id !== p.id)), () => {})} />
                    <Button title="Удалить" variant="secondary" size="s"
                      onPress={() => moderatePost(p.id, false).then(() => setReported((r) => r.filter((x) => x.id !== p.id)), () => {})} />
                  </View>
                </View>
              ))}
            </View>
          )}

          <View style={{ gap: space[3] }}>
            <Txt variant="title" style={{ fontSize: 20, lineHeight: 26 }}>{isOperator ? 'Клиенты без тренера' : 'Ученики сегодня'}</Txt>
            {data.students.length === 0 && (
              <View style={[styles.empty, { backgroundColor: c.surface }]}>
                <Txt variant="headline" center>{t('Пока никого')}</Txt>
                <Txt variant="caption" tone="muted" center>
                  {isOperator ? 'Все клиенты пока с тренерами.' : 'Отправьте код ученику — он введёт его при регистрации или в профиле.'}
                </Txt>
              </View>
            )}
            {data.students.map((s) => (
              <Pressable
                key={s.user_id}
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/student', params: { id: String(s.user_id) } })}
                style={({ pressed }) => [styles.student, { backgroundColor: c.surface, opacity: pressed ? 0.85 : 1 }]}>
                <View style={styles.row}>
                  <Txt variant="headline">{s.label}</Txt>
                  <Txt variant="caption" tone="muted">
                    серия {s.streak_days} {daysWord(s.streak_days)}
                  </Txt>
                </View>
                <View style={[styles.track, { backgroundColor: c.track }]}>
                  <View style={{ width: `${Math.min(100, (s.kcal_today / s.kcal_target) * 100)}%`, height: 6, borderRadius: 3, backgroundColor: c.accent }} />
                </View>
                <View style={styles.row}>
                  <Txt variant="caption" tone="muted">
                    {s.meals_today ? `${fmt(s.kcal_today)} из ${fmt(s.kcal_target)} ккал · приёмов: ${s.meals_today}` : 'Сегодня фото ещё не было'}
                  </Txt>
                  {s.pending_reviews > 0 && <StatusPill status="draft" label={`Ждут проверки: ${s.pending_reviews}`} />}
                </View>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <Txt variant="caption" tone="muted">
        {isOperator
          ? 'Здесь разборы клиентов без тренера и разборы учеников, которые ждут дольше 15 минут.'
          : 'Разборы приходят сюда сразу после фото. Ученик ждёт проверку в течение 15 минут — если не успеваете, их проверят операторы Nutrivia.'}
      </Txt>
      <Button title={t('Выйти')} variant="secondary" onPress={signOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  codeCard: { borderRadius: radius.l, padding: space[5], gap: space[1] },
  empty: { borderRadius: radius.m, padding: space[5], gap: space[2], alignItems: 'center' },
  student: { borderRadius: radius.m, padding: space[4], gap: space[2] },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
});

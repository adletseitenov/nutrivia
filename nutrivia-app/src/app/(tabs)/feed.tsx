import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';

import { addPost, ApiError, deletePost, getFeed, likePost, reportPost, type Post } from '@/api/client';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { MascotSlot } from '@/components/mascot-slot';
import { MealPhoto } from '@/components/meal-photo';
import { Screen } from '@/components/screen';
import { Txt } from '@/components/txt';
import { fmt } from '@/engine/engine';
import { FEATURES } from '@/lib/features';
import { t } from '@/lib/i18n';
import { useAppStore } from '@/store/app-store';
import { font, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

const FILTERS: { id: Post['kind'] | null; label: string }[] = [
  { id: null, label: 'Всё' },
  { id: 'recipe', label: 'Рецепты' },
  { id: 'habit', label: 'Привычки' },
];
const KIND_LABEL = { recipe: 'Рецепт', habit: 'Привычка' } as const;

function confirm(title: string, text: string, action: string, onYes: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n${text}`)) onYes();
    return;
  }
  Alert.alert(title, text, [{ text: t('Отмена'), style: 'cancel' }, { text: action, style: 'destructive', onPress: onYes }]);
}

/**
 * Лента сообщества (как FatSecret): рецепты и привычки участников.
 * Результаты — привычками (серия, белок), а не килограммами: риск РПП из обзора 06.10; сервер не пропускает «−3 кг».
 */
export default function Feed() {
  const c = useColors();
  const { width } = useWindowDimensions();
  const { state } = useAppStore();
  const [filter, setFilter] = useState<Post['kind'] | null>(null);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [writing, setWriting] = useState(false);
  const [kind, setKind] = useState<Post['kind']>('recipe');
  const [text, setText] = useState('');
  const [attach, setAttach] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((k: Post['kind'] | null) => {
    getFeed(k ?? undefined).then((r) => setPosts(r.posts), () => setPosts([]));
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (FEATURES.feed) load(filter);
    }, [filter, load]),
  );

  const lastMeal = state.meals.find((m) => m.serverId);

  if (!FEATURES.feed) {
    return (
      <Screen tabs>
        <Txt variant="title" style={{ fontFamily: font.extrabold, fontSize: 28, lineHeight: 34 }}>{t('Лента')}</Txt>
        <View style={[styles.soon, { backgroundColor: c.surface }]}>
          <MascotSlot stage={1} size={96} />
          <Txt variant="headline" center>{t('Скоро здесь будет лента')}</Txt>
        </View>
      </Screen>
    );
  }

  async function publish() {
    setError(null);
    try {
      const p = await addPost(kind, text, attach && lastMeal?.serverId ? lastMeal.serverId : undefined);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPosts((ps) => [p, ...(ps ?? [])]);
      setWriting(false);
      setText('');
      setAttach(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('Не получилось опубликовать. Попробуйте ещё раз.'));
    }
  }

  const replace = (p: Post) => setPosts((ps) => (ps ?? []).map((x) => (x.id === p.id ? p : x)));
  const drop = (id: number) => setPosts((ps) => (ps ?? []).filter((x) => x.id !== id));

  return (
    <Screen tabs>
      <View style={styles.head}>
        <Txt variant="title" style={{ fontFamily: font.extrabold, fontSize: 28, lineHeight: 34 }}>{t('Лента')}</Txt>
        {!writing && <Button title={t('Поделиться')} variant="accent" size="s" onPress={() => setWriting(true)} />}
      </View>

      {writing && (
        <View style={[styles.card, { backgroundColor: c.surface }]}>
          <View style={styles.row}>
            {(['recipe', 'habit'] as const).map((k) => (
              <Pressable key={k} accessibilityRole="radio" accessibilityState={{ checked: kind === k }}
                onPress={() => setKind(k)} style={[styles.chip, { backgroundColor: kind === k ? c.ink : c.bg }]}>
                <Txt variant="label" style={{ color: kind === k ? c.onInk : c.ink, fontSize: 14 }}>{t(KIND_LABEL[k])}</Txt>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            maxLength={1000}
            autoFocus
            placeholder={kind === 'recipe' ? t('Что приготовили и как — коротко') : t('Какая привычка помогает: что делаете и сколько дней')}
            placeholderTextColor={c.muted}
            accessibilityLabel={t('Текст поста')}
            style={[styles.area, { backgroundColor: c.bg, color: c.ink }]}
          />
          {lastMeal && (
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: attach }} onPress={() => setAttach(!attach)} style={styles.row}>
              <View style={[styles.box, { borderColor: attach ? c.accent : c.line, backgroundColor: attach ? c.accent : 'transparent' }]}>
                {attach && <Icon name="check" size={14} color={c.onAccent} strokeWidth={2.6} />}
              </View>
              <Txt variant="caption" style={{ flex: 1 }}>
                {t('Прикрепить последний приём пищи')}: {lastMeal.title.toLowerCase()}
              </Txt>
            </Pressable>
          )}
          <Txt variant="caption" tone="muted">{t('Без килограммов и цифр веса — делимся привычками и рецептами.')}</Txt>
          {error && <Txt variant="caption" tone="warning">{error}</Txt>}
          <View style={styles.row}>
            <Button title={t('Опубликовать')} variant="accent" disabled={text.trim().length < 3} onPress={publish} />
            <Button title={t('Отмена')} variant="secondary" onPress={() => { setWriting(false); setError(null); }} />
          </View>
        </View>
      )}

      <View style={styles.row}>
        {FILTERS.map((f) => (
          <Pressable key={f.label} accessibilityRole="tab" accessibilityState={{ selected: filter === f.id }}
            onPress={() => { setFilter(f.id); setPosts(null); load(f.id); }}
            style={[styles.chip, { backgroundColor: filter === f.id ? c.ink : c.surface }]}>
            <Txt variant="label" style={{ color: filter === f.id ? c.onInk : c.ink, fontSize: 14 }}>{t(f.label)}</Txt>
          </Pressable>
        ))}
      </View>

      {posts && posts.length === 0 && (
        <View style={[styles.soon, { backgroundColor: c.surface }]}>
          <MascotSlot stage={1} size={80} />
          <Txt variant="headline" center>{t('Пока тихо')}</Txt>
          <Txt variant="caption" tone="muted" center>{t('Поделитесь рецептом или привычкой — это помогает другим держать ритм.')}</Txt>
        </View>
      )}

      {(posts ?? []).map((p) => (
        <View key={p.id} style={[styles.card, { backgroundColor: c.surface }]}>
          <View style={styles.between}>
            <View>
              <Txt variant="headline" style={{ fontSize: 15 }}>{p.mine ? t('Вы') : p.author}</Txt>
              <Txt variant="caption" tone="muted">{p.at}</Txt>
            </View>
            <View style={[styles.pill, { backgroundColor: c.accentTint }]}>
              <Txt variant="label" tone="accent">{t(KIND_LABEL[p.kind])}</Txt>
            </View>
          </View>
          <Txt style={{ fontSize: 15, lineHeight: 22 }}>{p.text}</Txt>
          {p.meal && (
            <View style={{ gap: space[2] }}>
              {p.meal.has_photo && <MealPhoto uri={`post:${p.id}`} width={width - space[5] * 2 - space[4] * 2} height={200} radius={radius.s} />}
              <Txt variant="caption" tone="muted">
                {p.meal.items.join(', ')} · {fmt(p.meal.kcal)} {t('ккал')} · {t('белок')} {fmt(p.meal.protein)} {t('г')}
              </Txt>
            </View>
          )}
          <View style={styles.between}>
            <Pressable accessibilityRole="button" accessibilityLabel={p.liked ? t('Убрать лайк') : t('Нравится')}
              onPress={() => { Haptics.selectionAsync(); likePost(p.id).then(replace, () => {}); }} style={styles.row} hitSlop={8}>
              <Icon name="heart" size={20} color={p.liked ? c.accent : c.muted} fill={p.liked ? c.accent : 'none'} />
              <Txt variant="caption" tone={p.liked ? 'accent' : 'muted'}>{p.likes || ''}</Txt>
            </Pressable>
            <Pressable accessibilityRole="button" hitSlop={8}
              onPress={() => p.mine
                ? confirm(t('Удалить пост?'), t('Пост исчезнет из ленты.'), t('Удалить'), () => deletePost(p.id).then(() => drop(p.id), () => {}))
                : confirm(t('Пожаловаться?'), t('Модератор посмотрит пост. После нескольких жалоб он скрывается.'), t('Пожаловаться'),
                  () => reportPost(p.id).then(() => drop(p.id), () => {}))}>
              <Txt variant="caption" tone="muted">{p.mine ? t('Удалить') : t('Пожаловаться')}</Txt>
            </Pressable>
          </View>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  chip: { borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 8, minHeight: 36, justifyContent: 'center' },
  card: { borderRadius: radius.m, padding: space[4], gap: space[3] },
  pill: { borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  area: { minHeight: 96, borderRadius: radius.s, padding: space[3], fontFamily: font.regular, fontSize: 15, lineHeight: 22, textAlignVertical: 'top' },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  soon: { borderRadius: radius.m, padding: space[5], alignItems: 'center', gap: space[3] },
});

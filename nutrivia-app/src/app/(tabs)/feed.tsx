import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { MealPhoto } from '@/components/meal-photo';
import { MacroDots } from '@/components/rings';
import { RoundButton } from '@/components/round-button';
import { Screen } from '@/components/screen';
import { Txt } from '@/components/txt';
import { font, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

const TABS = ['Для вас', 'Рецепты', 'Результаты', 'Подписки'];

/**
 * Лента сообщества (как FatSecret). Сейчас — демо-посты.
 * Результаты показываем привычками (серия, белок), а не килограммами: риск РПП из обзора 06.10.
 */
export default function Feed() {
  const c = useColors();
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState(0);
  const [liked, setLiked] = useState(false);

  return (
    <Screen tabs>
      <View style={styles.head}>
        <Txt variant="title" style={{ fontFamily: font.extrabold, fontSize: 28, lineHeight: 34 }}>Лента</Txt>
        <View style={{ flexDirection: 'row', gap: space[2] }}>
          <RoundButton icon="search" label="Поиск" />
          <RoundButton icon="plus" label="Новый пост" tone="ink" />
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2] }} style={{ marginHorizontal: -space[5] }}>
        <View style={{ width: space[5] - space[2] }} />
        {TABS.map((name, i) => (
          <Pressable
            key={name}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === i }}
            onPress={() => setTab(i)}
            style={[styles.chip, { backgroundColor: tab === i ? c.ink : c.surface }]}>
            <Txt style={{ fontFamily: font.semibold, fontSize: 14, color: tab === i ? c.onInk : c.ink }}>{name}</Txt>
          </Pressable>
        ))}
        <View style={{ width: space[5] - space[2] }} />
      </ScrollView>

      <View style={{ gap: space[3] }}>
        <View style={styles.author}>
          <View style={[styles.avatar, { backgroundColor: c.surface }]}><Txt variant="label">МК</Txt></View>
          <View style={{ flex: 1 }}>
            <Txt variant="headline" style={{ fontSize: 15, lineHeight: 20 }}>Мадина К.</Txt>
            <Txt variant="caption" tone="muted" style={{ fontSize: 12 }}>Рецепт · 2 ч назад</Txt>
          </View>
          <View style={[styles.badge, { backgroundColor: c.greenTint }]}>
            <Txt variant="label" tone="green">Серия 21 день</Txt>
          </View>
        </View>
        <View>
          <MealPhoto uri="demo:plov" width={width - space[5] * 2} height={220} radius={radius.m} />
          <View style={[styles.kcalTag, { backgroundColor: c.surfaceRaised }]}>
            <Txt variant="label" style={{ fontSize: 13 }}>≈480 ккал на пиалу</Txt>
          </View>
        </View>
        <View style={{ gap: 4 }}>
          <Txt variant="headline">Плов полегче: меньше масла, больше моркови</Txt>
          <View style={{ flexDirection: 'row', gap: space[3], alignItems: 'center' }}>
            <MacroDots protein={24} carbs={58} fat={16} />
            <Txt variant="caption" tone="muted">· 40 мин</Txt>
          </View>
        </View>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: liked }}
            accessibilityLabel="Нравится"
            onPress={() => { Haptics.selectionAsync(); setLiked(!liked); }}
            style={styles.action}>
            <Icon name="heart" size={22} color={c.ink} fill={liked ? c.ink : 'none'} />
            <Txt variant="label" style={{ fontSize: 14 }}>{liked ? 129 : 128}</Txt>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Комментарии" style={styles.action}>
            <Icon name="comment" size={22} color={c.ink} />
            <Txt variant="label" style={{ fontSize: 14 }}>24</Txt>
          </Pressable>
          <Button title="В дневник" variant="secondary" size="s" style={{ marginLeft: 'auto' }} />
        </View>
      </View>

      <View style={{ height: 1, backgroundColor: c.line }} />

      <View style={{ gap: space[3] }}>
        <View style={styles.author}>
          <View style={[styles.avatar, { backgroundColor: c.ink }]}><Txt variant="label" style={{ color: c.onInk }}>ЕБ</Txt></View>
          <View style={{ flex: 1 }}>
            <Txt variant="headline" style={{ fontSize: 15, lineHeight: 20 }}>Ержан Б.</Txt>
            <Txt variant="caption" tone="muted" style={{ fontSize: 12 }}>Результат месяца · вчера</Txt>
          </View>
        </View>
        <Txt style={{ fontSize: 15, lineHeight: 22 }}>Месяц с Nutrivia: начал завтракать и перестал есть ночью. Нутрициолог помог с белком.</Txt>
        <View style={{ flexDirection: 'row', gap: space[2] }}>
          {[['28', 'дней серии'], ['4', 'стадия маскота'], ['96 г', 'белка в день']].map(([v, l]) => (
            <View key={l} style={[styles.stat, { backgroundColor: c.surface }]}>
              <Txt variant="numberM" style={{ fontSize: 20, lineHeight: 24 }}>{v}</Txt>
              <Txt variant="caption" tone="muted" style={{ fontSize: 12, lineHeight: 16 }}>{l}</Txt>
            </View>
          ))}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.full },
  author: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  badge: { borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  kcalTag: { position: 'absolute', left: space[3], bottom: space[3], borderRadius: radius.full, paddingHorizontal: space[3], paddingVertical: 6 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  stat: { flex: 1, borderRadius: 16, padding: space[3], gap: 2 },
});

import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { searchDishes, type DishHit } from '@/api/client';
import { fmt } from '@/engine/engine';
import { font, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

import { Icon } from './icon';
import { RoundButton } from './round-button';
import { Txt } from './txt';

/** Лист «Добавить блюдо»: поиск по базе сервера (та же база, что у Engine). */
export function AddDishSheet({ visible, onClose, onPick }: {
  visible: boolean;
  onClose: () => void;
  onPick: (dish: DishHit) => void;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<DishHit[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!visible) return;
    // Небольшая задержка, чтобы не слать запрос на каждую букву
    const timer = setTimeout(() => {
      searchDishes(q.trim()).then(
        (r) => { setHits(r); setFailed(false); },
        () => setFailed(true),
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [q, visible]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: c.bg, paddingBottom: insets.bottom }]}>
        <View style={styles.head}>
          <Txt variant="title">Добавить блюдо</Txt>
          <RoundButton icon="close" label="Закрыть" onPress={onClose} />
        </View>
        <View style={[styles.search, { backgroundColor: c.surface }]}>
          <Icon name="search" size={20} color={c.muted} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Например, манты или лепёшка"
            placeholderTextColor={c.muted}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Поиск блюда"
            style={[styles.input, { color: c.ink }]}
          />
        </View>
        {failed && <Txt tone="muted" center>Нет связи с сервером. Попробуйте ещё раз.</Txt>}
        {!hits && !failed && <ActivityIndicator color={c.ink} style={{ marginTop: space[5] }} />}
        {hits && (
          <FlatList
            data={hits}
            keyExtractor={(d) => d.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: space[2], paddingBottom: space[5] }}
            ListEmptyComponent={
              <Txt tone="muted" center style={{ marginTop: space[5] }}>
                Такого блюда нет в базе. Напишите его в комментарии — нутрициолог добавит вручную.
              </Txt>
            }
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => onPick(item)}
                style={({ pressed }) => [styles.row, { backgroundColor: c.surface, opacity: pressed ? 0.7 : 1 }]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="headline" style={{ fontSize: 16 }}>{item.name}</Txt>
                  <Txt variant="caption" tone="muted">
                    1 {item.unit} · ≈{fmt(item.unit_grams)} г · {fmt((item.kcal_100g * item.unit_grams) / 100)} ккал
                  </Txt>
                </View>
                <Icon name="plus" size={20} color={c.ink} strokeWidth={2} />
              </Pressable>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space[5], paddingTop: space[5], gap: space[4] },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: space[2], borderRadius: radius.s, paddingHorizontal: space[3], minHeight: 48 },
  input: { flex: 1, fontFamily: font.medium, fontSize: 16, paddingVertical: space[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], borderRadius: radius.m, padding: space[4] },
});

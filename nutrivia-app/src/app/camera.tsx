import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { PlovArt } from '@/components/plov-art';
import { RoundButton } from '@/components/round-button';
import { Txt } from '@/components/txt';
import { font, space } from '@/theme/tokens';

type Mode = 'food' | 'fridge';

const COPY: Record<Mode, { title: string; hint: string; sub: string }> = {
  food: { title: 'Сфотографируйте еду', hint: 'Вся тарелка в кадре, сверху', sub: 'Хлеб, чай и соусы тоже снимите — их посчитаем отдельно' },
  fridge: { title: 'Сфотографируйте холодильник', hint: 'Откройте дверцу, полки целиком', sub: 'Подберём блюда из того, что есть, под ваш остаток дня' },
};

/** Камера всегда тёмная, как системная, — вне светлой/тёмной темы приложения. */
export default function Camera() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<Mode>('food');
  const cam = useRef<CameraView>(null);
  // В симуляторе камеры нет — показываем демо-тарелку, а снимок подменяем демо-фото
  const demo = !Device.isDevice;
  const copy = COPY[mode];
  const frame = width - 70;

  function go(uri: string) {
    if (mode === 'food') router.replace({ pathname: '/review', params: { photo: uri } });
    else router.replace({ pathname: '/fridge', params: { photo: uri } });
  }

  async function shoot() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (demo || !cam.current) return go('demo:plov');
    const pic = await cam.current.takePictureAsync({ quality: 0.7 });
    go(pic.uri);
  }

  async function pick() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!res.canceled) go(res.assets[0].uri);
  }

  const needPermission = !demo && permission && !permission.granted;

  return (
    <View style={styles.root}>
      <View style={[styles.viewfinder, { top: insets.top + 64, height: width + 40 }]}>
        {demo ? (
          <PlovArt width={width} height={width + 40} />
        ) : permission?.granted ? (
          <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" />
        ) : null}
        {needPermission && (
          <View style={styles.permission}>
            <Txt variant="headline" tone="onInk" center style={{ color: '#FFFFFF' }}>Нужен доступ к камере</Txt>
            <Txt variant="caption" center style={{ color: 'rgba(255,255,255,0.7)' }}>Фото еды видите только вы и ваш нутрициолог.</Txt>
            <Button title="Разрешить" variant="accent" onPress={requestPermission} />
          </View>
        )}
        <View pointerEvents="none" style={[styles.frame, { width: frame, height: frame, left: 35, top: 35 }]}>
          <View style={[styles.corner, { left: 0, top: 0, borderLeftWidth: 4, borderTopWidth: 4, borderTopLeftRadius: 28 }]} />
          <View style={[styles.corner, { right: 0, top: 0, borderRightWidth: 4, borderTopWidth: 4, borderTopRightRadius: 28 }]} />
          <View style={[styles.corner, { left: 0, bottom: 0, borderLeftWidth: 4, borderBottomWidth: 4, borderBottomLeftRadius: 28 }]} />
          <View style={[styles.corner, { right: 0, bottom: 0, borderRightWidth: 4, borderBottomWidth: 4, borderBottomRightRadius: 28 }]} />
        </View>
      </View>

      <View style={[styles.top, { top: insets.top + space[2] }]}>
        <RoundButton icon="close" label="Закрыть камеру" tone="glass" onPress={() => router.back()} />
        <Txt variant="headline" style={{ color: '#FFFFFF', fontSize: 15 }}>{copy.title}</Txt>
        <RoundButton icon="flash" label="Вспышка" tone="glass" />
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space[5] }]}>
        <View style={{ gap: 6, alignItems: 'center' }}>
          <Txt variant="headline" center style={{ color: '#FFFFFF', fontSize: 15 }}>{copy.hint}</Txt>
          <Txt variant="caption" center style={{ color: 'rgba(255,255,255,0.68)' }}>{copy.sub}</Txt>
        </View>

        <View style={styles.modes} accessibilityRole="radiogroup">
          {(['food', 'fridge'] as Mode[]).map((m) => {
            const on = m === mode;
            return (
              <Pressable
                key={m}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() => { Haptics.selectionAsync(); setMode(m); }}
                style={[styles.mode, on && { backgroundColor: '#FFFFFF' }]}>
                <Txt style={{ fontFamily: font.semibold, fontSize: 14, color: on ? '#0B0D0C' : '#FFFFFF' }}>
                  {m === 'food' ? 'Еда' : 'Холодильник'}
                </Txt>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.controls}>
          <Pressable accessibilityRole="button" accessibilityLabel="Выбрать из галереи" onPress={pick} style={styles.side}>
            <Icon name="image" color="#FFFFFF" />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Сделать снимок" onPress={shoot} style={({ pressed }) => [styles.shutter, { transform: [{ scale: pressed ? 0.94 : 1 }] }]}>
            <View style={styles.shutterInner} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Ввести вручную" style={styles.side}>
            <Icon name="edit" color="#FFFFFF" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  viewfinder: { position: 'absolute', left: 0, right: 0, overflow: 'hidden', backgroundColor: '#111' },
  permission: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: space[3], padding: space[6] },
  frame: { position: 'absolute' },
  corner: { position: 'absolute', width: 44, height: 44, borderColor: '#FFFFFF' },
  top: { position: 'absolute', left: space[5], right: space[5], flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bottom: { position: 'absolute', left: space[5], right: space[5], bottom: 0, gap: space[5], alignItems: 'center' },
  modes: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)' },
  mode: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
  controls: { flexDirection: 'row', alignSelf: 'stretch', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space[3] },
  side: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  shutter: { width: 80, height: 80, borderRadius: 40, borderWidth: 4, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFFFFF' },
});

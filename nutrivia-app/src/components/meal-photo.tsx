import { Image } from 'expo-image';
import { View } from 'react-native';

import { photoSource } from '@/api/client';
import { useColors } from '@/theme/use-colors';

import { PlovArt } from './plov-art';

/** Фото приёма пищи: снимок на телефоне, своё с сервера (server:<id>), ученика (pro:<id>), демо-плов или заглушка. */
export function MealPhoto({ uri, width, height, radius = 0 }: { uri?: string | null; width: number; height: number; radius?: number }) {
  const c = useColors();
  if (uri === 'demo:plov') {
    return (
      <View style={{ width, height, borderRadius: radius, overflow: 'hidden' }}>
        <PlovArt width={width} height={height} />
      </View>
    );
  }
  const source = uri?.startsWith('server:')
    ? photoSource(Number(uri.slice(7)))
    : uri?.startsWith('pro:')
      ? photoSource(Number(uri.slice(4)), 'pro')
      : uri
        ? { uri }
        : null;
  if (source) {
    return (
      <Image
        source={source}
        style={{ width, height, borderRadius: radius, backgroundColor: c.track }}
        contentFit="cover"
        cachePolicy="memory-disk"
      />
    );
  }
  return <View style={{ width, height, borderRadius: radius, backgroundColor: c.track }} />;
}

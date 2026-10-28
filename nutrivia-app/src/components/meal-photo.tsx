import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';

import { photoSource } from '@/api/client';
import { useColors } from '@/theme/use-colors';

import { PlovArt } from './plov-art';

type Source = { uri: string; headers?: Record<string, string> };

/** В браузере картинка не может отправить заголовок авторизации — скачиваем фото сами и показываем по blob-адресу. */
function useWebAuthed(source: Source | null) {
  const [blobUri, setBlobUri] = useState<string | null>(null);
  const needs = Platform.OS === 'web' && !!source?.headers;
  const uri = source?.uri;
  const auth = source?.headers?.Authorization;
  useEffect(() => {
    if (!needs || !uri) return;
    let url: string | null = null;
    let alive = true;
    fetch(uri, { headers: auth ? { Authorization: auth } : undefined })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (b && alive) setBlobUri((url = URL.createObjectURL(b)));
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [needs, uri, auth]);
  return needs ? (blobUri ? { uri: blobUri } : null) : source;
}

/** Фото приёма пищи: снимок на телефоне, своё с сервера (server:<id>), ученика (pro:<id>), демо-плов или заглушка. */
export function MealPhoto({ uri, width, height, radius = 0 }: { uri?: string | null; width: number; height: number; radius?: number }) {
  const c = useColors();
  const source: Source | null = uri?.startsWith('server:')
    ? photoSource(Number(uri.slice(7)))
    : uri?.startsWith('pro:')
      ? photoSource(Number(uri.slice(4)), 'pro')
      : uri && uri !== 'demo:plov'
        ? { uri }
        : null;
  const shown = useWebAuthed(source);
  if (uri === 'demo:plov') {
    return (
      <View style={{ width, height, borderRadius: radius, overflow: 'hidden' }}>
        <PlovArt width={width} height={height} />
      </View>
    );
  }
  if (shown) {
    return (
      <Image
        source={shown}
        style={{ width, height, borderRadius: radius, backgroundColor: c.track }}
        contentFit="cover"
        cachePolicy="memory-disk"
      />
    );
  }
  return <View style={{ width, height, borderRadius: radius, backgroundColor: c.track }} />;
}

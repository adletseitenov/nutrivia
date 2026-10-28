import {
  Onest_400Regular,
  Onest_500Medium,
  Onest_600SemiBold,
  Onest_700Bold,
  Onest_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/onest';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AppStoreProvider, useAppStore } from '@/store/app-store';
import { palette } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync();

// Экраны, куда без входа нельзя
const PUBLIC = new Set(['index', 'welcome', 'role', 'goal', 'pro-name', 'phone', 'code']);

/** Сессия сброшена (вышли, истекла, сервер ответил 401) — с закрытого экрана уводим на вход. */
function SessionGuard() {
  const { state } = useAppStore();
  const segments = useSegments();
  const top = segments[0] ?? 'index';
  useEffect(() => {
    if (state.booted && !state.onboarded && !PUBLIC.has(top)) router.replace('/welcome');
  }, [state.booted, state.onboarded, top]);
  return null;
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const [loaded] = useFonts({ Onest_400Regular, Onest_500Medium, Onest_600SemiBold, Onest_700Bold, Onest_800ExtraBold });

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;

  const dark = scheme === 'dark';
  const base = dark ? DarkTheme : DefaultTheme;
  const c = dark ? palette.dark : palette.light;
  const theme = { ...base, colors: { ...base.colors, background: c.bg, card: c.bg, text: c.ink, primary: c.green, border: c.line } };

  return (
    <ThemeProvider value={theme}>
      <AppStoreProvider>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <SessionGuard />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="welcome" />
          <Stack.Screen name="role" />
          <Stack.Screen name="goal" />
          <Stack.Screen name="pro-name" />
          <Stack.Screen name="phone" />
          <Stack.Screen name="code" />
          <Stack.Screen name="pro" options={{ gestureEnabled: false }} />
          <Stack.Screen name="join" options={{ presentation: 'modal' }} />
          <Stack.Screen name="pro-review" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="camera" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="review" />
          <Stack.Screen name="meal" />
          <Stack.Screen name="streak" />
          <Stack.Screen name="fridge" />
        </Stack>
      </AppStoreProvider>
    </ThemeProvider>
  );
}

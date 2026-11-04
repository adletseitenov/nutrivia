/** Маленькие значения на устройстве: в браузере — localStorage, на телефоне — SecureStore. Ошибки хранилища не роняют экран. */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const WEB = Platform.OS === 'web';

export async function kvGet(key: string): Promise<string | null> {
  try {
    return WEB ? localStorage.getItem(key) : await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: string): Promise<void> {
  try {
    if (WEB) localStorage.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    // не сохранилось — не страшно
  }
}

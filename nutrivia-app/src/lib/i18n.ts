/**
 * Русский — исходный язык: ключ перевода и есть русский текст. t('Сегодня') → «Бүгін» на казахском.
 * Нет перевода — показываем русский. Язык хранится на устройстве и в профиле на сервере.
 * Смена языка перерисовывает приложение целиком (key на корневом провайдере).
 */
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { KK } from './kk';

export type Lang = 'ru' | 'kk';

const KEY = 'nutrivia.lang';
let lang: Lang = 'ru';
const listeners = new Set<() => void>();

export function t(ru: string): string {
  return lang === 'kk' ? (KK[ru] ?? ru) : ru;
}

export function getLang(): Lang {
  return lang;
}

export async function loadLang() {
  try {
    const v = Platform.OS === 'web' ? localStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    if (v === 'kk' || v === 'ru') setLangLocal(v);
  } catch {
    // нет хранилища — остаёмся на русском
  }
}

function setLangLocal(v: Lang) {
  lang = v;
  listeners.forEach((l) => l());
}

export async function setLang(v: Lang) {
  setLangLocal(v);
  try {
    if (Platform.OS === 'web') localStorage.setItem(KEY, v);
    else await SecureStore.setItemAsync(KEY, v);
  } catch {
    // не сохранилось — до перезапуска язык всё равно сменён
  }
}

export function useLang(): Lang {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => lang, () => lang);
}

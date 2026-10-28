/**
 * Клиент API (nutrivia-bot/nutrivia/api.py). Фото уходит на наш сервер — ключ AI там,
 * разбор делает claude-opus-5-5, нутриенты считает Engine сервера.
 *
 * Вход по номеру телефона и коду из SMS; токен сессии хранится в SecureStore
 * и уходит в заголовке Authorization: Bearer.
 */
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import type { Goal } from '@/store/app-store';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';
const KEY = 'nutrivia.session';

export type ServerItem = {
  dish_id: string | null;
  raw_name: string;
  name: string;
  grams: number;
  /** оценка модели по фото; отличается от grams, если порцию поправили */
  ai_grams?: number | null;
  portion: string | null;
  unit: string | null;
  unit_grams: number | null;
  kcal: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  confidence: number | null;
  in_base: boolean;
};

export type ServerMeal = {
  id: number;
  status: 'draft' | 'reviewed' | 'not_food';
  received_at?: number;
  items: ServerItem[];
  comment?: string | null;
  reviewed_at?: number | null;
  reviewer?: { name: string; role: 'trainer' | 'nutritionist' | 'operator' } | null;
  has_photo?: boolean;
  night?: boolean;
};

export type ServerToday = {
  meals: ServerMeal[];
  totals: { kcal: number; protein: number; fat: number; carbs: number };
  targets: { kcal: number; protein: number };
};

export type ServerProgress = {
  streak: {
    days: number;
    best: number;
    stage: number;
    stage_days: number[];
    next_stage_in: number | null;
    photos_today: number;
    min_photos: number;
    today_counted: boolean;
  };
  week: {
    /** weekday: 0 — понедельник */
    days: { date: string; weekday: number; meals: number; kcal: number; protein: number }[];
    logged_days: number;
    avg_kcal: number | null;
    avg_protein: number | null;
    reviewed_photos: number;
    targets: { kcal: number; protein: number };
    coach: { name: string | null; comment: string | null };
  };
};

export type Role = 'client' | 'trainer' | 'nutritionist';

export type Me = {
  user_id: number;
  role: Role;
  goal: string | null;
  lang: string;
  coach: { name: string; code: string } | null;
  pro?: { name: string; invite_code: string; students: number; limit: number | null };
};

export type Student = {
  user_id: number;
  label: string;
  goal: string | null;
  meals_today: number;
  kcal_today: number;
  kcal_target: number;
  pending_reviews: number;
  streak_days: number;
};

export type ProMeal = ServerMeal & {
  student: string;
  student_id: number;
  student_goal?: string | null;
  student_restrictions?: string | null;
};

export type DishHit = { id: string; name: string; unit: string; unit_grams: number; kcal_100g: number };

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public retryAfter?: number) {
    super(message);
  }
}

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

/** Стор подписывается: сессия истекла или отозвана — вернуть на экран входа. */
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function hasSession() {
  token = token ?? (await SecureStore.getItemAsync(KEY));
  return !!token;
}

async function clearSession() {
  token = null;
  await SecureStore.deleteItemAsync(KEY);
}

/** Фото приёма пищи с сервера по токену сессии: своё (meal) или ученика (pro). */
export function photoSource(mealId: number, kind: 'meal' | 'pro' = 'meal') {
  const path = kind === 'pro' ? `/v1/pro/meals/${mealId}/photo` : `/v1/meals/${mealId}/photo`;
  return { uri: `${BASE}${path}`, headers: token ? { Authorization: `Bearer ${token}` } : undefined };
}

const STATUS_MESSAGES: Record<number, string> = {
  413: 'Фото слишком большое. Попробуйте снять ещё раз.',
  415: 'Этот формат фото не подходит. Снимите фото камерой приложения.',
  429: 'На сегодня лимит фото. Завтра продолжим!',
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch (e) {
    console.warn(`[api] ${path} network error`, e);
    throw new ApiError(0, 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
  }
  if (res.status === 401 && token) {
    await clearSession();
    onUnauthorized?.();
    throw new ApiError(401, 'Войдите заново.');
  }
  if (!res.ok) {
    // Ошибки входа сервер присылает как { code, message, retry_after } — текст уже для человека
    const body = (await res.json().catch(() => null)) as { code?: string; message?: string; retry_after?: number } | null;
    throw new ApiError(
      res.status,
      body?.message ?? STATUS_MESSAGES[res.status] ?? 'Сервер не ответил. Попробуйте ещё раз.',
      body?.code,
      body?.retry_after,
    );
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const json = (body: unknown): RequestInit => ({
  body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json' },
});

// --- вход ---

export const smsStart = (phone: string) =>
  request<{ phone: string; resend_after: number; expires_in: number; delivery: 'sms' | 'manual' }>('/v1/auth/sms/start', { method: 'POST', ...json({ phone }) });

export type SignupData = { role: Role; goal?: Goal; name?: string; inviteCode?: string };

/** Проверка кода. Согласие показано на экране приветствия перед «Начать» и «Войти». */
export async function smsVerify(phone: string, code: string, signup: SignupData) {
  const r = await request<{ token: string; is_new: boolean; join: string | null; join_message: string | null; me: Me }>(
    '/v1/auth/sms/verify',
    {
      method: 'POST',
      ...json({
        phone, code, consent: true, lang: 'ru', role: signup.role,
        goal: signup.role === 'client' && signup.goal ? (signup.goal === 'coach' ? 'coach_plan' : signup.goal) : undefined,
        name: signup.name || undefined,
        invite_code: signup.inviteCode || undefined,
      }),
    },
  );
  token = r.token;
  await SecureStore.setItemAsync(KEY, r.token);
  return r;
}

export async function logout() {
  try {
    await request<void>('/v1/auth/logout', { method: 'POST' });
  } finally {
    await clearSession();
  }
}

export const getMe = () => request<Me>('/v1/me');

export const patchGoal = (goal: Goal) =>
  request<Me>('/v1/me', { method: 'PATCH', ...json({ goal: goal === 'coach' ? 'coach_plan' : goal }) });

export const joinCoach = (inviteCode: string) => request<Me>('/v1/me/coach', { method: 'POST', ...json({ invite_code: inviteCode }) });

export const getQueue = () => request<{ meals: ProMeal[] }>('/v1/pro/queue');

export const getProMeal = (id: number) => request<ProMeal>(`/v1/pro/meals/${id}`);

export const putProItems = (id: number, items: { dish_id: string; grams: number }[]) =>
  request<ProMeal>(`/v1/pro/meals/${id}/items`, { method: 'PUT', ...json({ items }) });

export const proComment = (id: number, text: string) =>
  request<ProMeal>(`/v1/pro/meals/${id}/comment`, { method: 'POST', ...json({ text }) });

export const proSend = (id: number) => request<ProMeal>(`/v1/pro/meals/${id}/send`, { method: 'POST' });

export const getStudents = () => request<{ students: Student[]; me: Me }>('/v1/pro/students');

/** demo:plov — демо-снимок для симулятора, где нет камеры. */
async function resolvePhoto(uri: string) {
  if (uri === 'demo:plov') {
    const asset = Asset.fromModule(require('@/assets/images/demo-plov.png'));
    await asset.downloadAsync();
    return new File(asset.localUri ?? asset.uri);
  }
  return new File(uri);
}

export async function uploadMeal(uri: string) {
  const form = new FormData();
  // fetch в Expo SDK 58 принимает только Blob-подобные части (File из expo-file-system), не { uri, name, type }.
  // Тип файла сервер определяет по байтам.
  form.append('photo', (await resolvePhoto(uri)) as unknown as Blob);
  return request<ServerMeal>('/v1/meals', { method: 'POST', body: form });
}

export const getMeal = (id: number) => request<ServerMeal>(`/v1/meals/${id}`);

export const getToday = () => request<ServerToday>('/v1/today');

export const getProgress = () => request<ServerProgress>('/v1/progress');

export const searchDishes = (q: string) => request<DishHit[]>(`/v1/dishes?q=${encodeURIComponent(q)}`);

export const putItems = (id: number, items: { dish_id: string; grams: number }[]) =>
  request<ServerMeal>(`/v1/meals/${id}/items`, { method: 'PUT', ...json({ items }) });

export const confirmMeal = (id: number) => request<ServerMeal>(`/v1/meals/${id}/confirm`, { method: 'POST' });

export async function deleteMe() {
  await request<void>('/v1/users/me', { method: 'DELETE' });
  await clearSession();
}

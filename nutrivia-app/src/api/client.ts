/**
 * Клиент API (nutrivia-bot/nutrivia/api.py). Фото уходит на наш сервер — ключ AI там,
 * разбор делает claude-opus-5-5, нутриенты считает Engine сервера.
 *
 * Вход по номеру телефона и коду; токен сессии хранится в SecureStore (в браузере — в localStorage)
 * и уходит в заголовке Authorization: Bearer.
 */
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { Activity, Body } from '@/engine/targets';
import { getLang, type Lang } from '@/lib/i18n';
import type { Goal } from '@/store/app-store';

const WEB = Platform.OS === 'web';
// Веб-версию раздаёт тот же сервер, что и API, — в браузере хватает относительных адресов
const BASE = WEB ? process.env.EXPO_PUBLIC_API_URL || '' : (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000');
const KEY = 'nutrivia.session';

// Веб-версия для пилота: в браузере нет SecureStore
const store = {
  get: () => (WEB ? Promise.resolve(localStorage.getItem(KEY)) : SecureStore.getItemAsync(KEY)),
  set: (v: string) => (WEB ? Promise.resolve(localStorage.setItem(KEY, v)) : SecureStore.setItemAsync(KEY, v)),
  remove: () => (WEB ? Promise.resolve(localStorage.removeItem(KEY)) : SecureStore.deleteItemAsync(KEY)),
};

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
  status: 'draft' | 'reviewed' | 'not_food' | 'manual';
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
  /** «Совет на вечер»: блюда из базы под остаток дня (сервер, Engine) */
  advice?: Advice;
};

export type Advice = {
  remaining_kcal: number;
  hint: 'protein' | 'light' | null;
  options: { dish_id: string; name: string; grams: number; kcal: number; protein: number }[];
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
  /** operator — команда Nutrivia: клиенты без тренера и просроченные разборы, кода приглашения нет */
  pro?: { name: string; invite_code: string | null; students: number; limit: number | null; operator?: boolean };
  profile?: { sex: 'f' | 'm' | null; birth_year: number | null; height_cm: number | null; weight_kg: number | null; activity: Activity | null };
  /** set_by_pro — ориентир задал нутрициолог, параметры его не меняют */
  targets?: { kcal: number; protein: number; set_by_pro: boolean };
  /** Уведомления в Telegram: available — бот подключён на сервере, linked — человек привязал свой чат */
  telegram?: { available: boolean; linked: boolean };
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
let loaded: Promise<void> | null = null;
let onUnauthorized: (() => void) | null = null;

/** Стор подписывается: сессия истекла или отозвана — вернуть на экран входа. */
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

/** Сохранённая сессия читается один раз; запросы ждут её, чтобы не уйти без токена. */
function loadSession() {
  loaded ??= store.get().then((t) => {
    token = token ?? t;
  });
  return loaded;
}

export async function hasSession() {
  await loadSession();
  return !!token;
}

async function clearSession() {
  token = null;
  await store.remove();
}

/** Фото приёма пищи с сервера по токену сессии: своё (meal) или ученика (pro). */
export function photoSource(id: number, kind: 'meal' | 'pro' | 'post' = 'meal') {
  const path = kind === 'pro' ? `/v1/pro/meals/${id}/photo` : kind === 'post' ? `/v1/feed/${id}/photo` : `/v1/meals/${id}/photo`;
  return { uri: `${BASE}${path}`, headers: token ? { Authorization: `Bearer ${token}` } : undefined };
}

const STATUS_MESSAGES: Record<number, string> = {
  413: 'Фото слишком большое. Попробуйте снять ещё раз.',
  415: 'Этот формат фото не подходит. Снимите фото камерой приложения.',
  429: 'На сегодня лимит фото. Завтра продолжим!',
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  await loadSession();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  const sent = token;
  if (sent) headers.Authorization = `Bearer ${sent}`;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch (e) {
    console.warn(`[api] ${path} network error`, e);
    throw new ApiError(0, 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
  }
  // Сбрасываем, только если отказали именно текущему токену (а не запросу, ушедшему до входа)
  if (res.status === 401 && sent && sent === token) {
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
        phone, code, consent: true, lang: getLang(), role: signup.role,
        goal: signup.role === 'client' && signup.goal ? (signup.goal === 'coach' ? 'coach_plan' : signup.goal) : undefined,
        name: signup.name || undefined,
        invite_code: signup.inviteCode || undefined,
      }),
    },
  );
  token = r.token;
  await store.set(r.token);
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

/** Ссылка t.me/<бот>?start=app_… — живёт 15 минут, одноразовая. */
export const telegramLink = () => request<{ url: string }>('/v1/me/telegram', { method: 'POST' });
export const telegramUnlink = () => request<Me>('/v1/me/telegram', { method: 'DELETE' });
export const patchLang = (lang: Lang) => request<Me>('/v1/me', { method: 'PATCH', ...json({ lang }) });

/** Параметры для личной нормы калорий. */
export const patchBody = (b: Body) =>
  request<Me>('/v1/me', {
    method: 'PATCH',
    ...json({ sex: b.sex, birth_year: b.birthYear, height_cm: b.heightCm, weight_kg: b.weightKg, activity: b.activity }),
  });

export function bodyFromMe(me: Me | null): Body | null {
  const p = me?.profile;
  if (!p?.sex || !p.birth_year || !p.height_cm || !p.weight_kg || !p.activity) return null;
  return { sex: p.sex, birthYear: p.birth_year, heightCm: p.height_cm, weightKg: p.weight_kg, activity: p.activity };
}

export const joinCoach = (inviteCode: string) => request<Me>('/v1/me/coach', { method: 'POST', ...json({ invite_code: inviteCode }) });

export const getQueue = () => request<{ meals: ProMeal[] }>('/v1/pro/queue');

export const getProMeal = (id: number) => request<ProMeal>(`/v1/pro/meals/${id}`);

export const putProItems = (id: number, items: { dish_id: string; grams: number }[]) =>
  request<ProMeal>(`/v1/pro/meals/${id}/items`, { method: 'PUT', ...json({ items }) });

export const proComment = (id: number, text: string) =>
  request<ProMeal>(`/v1/pro/meals/${id}/comment`, { method: 'POST', ...json({ text }) });

export const proSend = (id: number) => request<ProMeal>(`/v1/pro/meals/${id}/send`, { method: 'POST' });

export const getStudents = () => request<{ students: Student[]; me: Me }>('/v1/pro/students');

export type StudentCard = {
  user_id: number;
  label: string;
  goal: string | null;
  profile: NonNullable<Me['profile']>;
  targets: NonNullable<Me['targets']>;
  week: ServerProgress['week'];
  streak: ServerProgress['streak'];
  weights: ServerWeights;
  meals: ServerMeal[];
  note: string;
};

export const getStudentCard = (id: number) => request<StudentCard>(`/v1/pro/students/${id}`);

export const setWeekComment = (id: number, text: string) =>
  request<StudentCard>(`/v1/pro/students/${id}/week-comment`, { method: 'POST', ...json({ text }) });

/** Ориентир калорий от специалиста; null — вернуть личный расчёт. */
export const setStudentTarget = (id: number, kcal: number | null) =>
  request<StudentCard>(`/v1/pro/students/${id}/target`, { method: 'PUT', ...json({ kcal }) });

export const setStudentNote = (id: number, text: string) =>
  request<{ ok: boolean }>(`/v1/pro/students/${id}/note`, { method: 'PUT', ...json({ text }) });

/** demo:plov — демо-снимок для симулятора, где нет камеры. */
async function resolvePhoto(uri: string) {
  if (uri === 'demo:plov') {
    const asset = Asset.fromModule(require('@/assets/images/demo-plov.png'));
    await asset.downloadAsync();
    return new File(asset.localUri ?? asset.uri);
  }
  return new File(uri);
}

export type FridgeIdea = {
  title: string;
  minutes: number;
  items: { dish_id: string; name: string; grams: number; kcal: number; protein: number }[];
  kcal: number;
  protein: number;
  fits: boolean;
  /** порция уменьшена под остаток дня */
  smaller: boolean;
};
export type FridgeResult = { status: 'ok' | 'empty'; products: string[]; ideas: FridgeIdea[]; remaining_kcal: number };

/** Фото холодильника → продукты и блюда из базы под остаток дня. Фото на сервере не хранится. */
export async function uploadFridge(uri: string) {
  const form = new FormData();
  if (WEB) form.append('photo', await (await fetch(uri)).blob(), 'fridge.jpg');
  else form.append('photo', (await resolvePhoto(uri)) as unknown as Blob);
  return request<FridgeResult>('/v1/fridge', { method: 'POST', body: form });
}

/** Пересчитать блюда по списку продуктов без ИИ (убрали лишнее, дописали своё). */
export const fridgeIdeas = (products: string[]) =>
  request<FridgeResult>('/v1/fridge/ideas', { method: 'POST', ...json({ products }) });

export async function uploadMeal(uri: string) {
  const form = new FormData();
  if (WEB) {
    // В браузере снимок — data: или blob: адрес; отдаём его байты как обычный файл
    const blob = await (await fetch(uri === 'demo:plov' ? Asset.fromModule(require('@/assets/images/demo-plov.png')).uri : uri)).blob();
    form.append('photo', blob, 'meal.jpg');
    return request<ServerMeal>('/v1/meals', { method: 'POST', body: form });
  }
  // fetch в Expo SDK 58 принимает только Blob-подобные части (File из expo-file-system), не { uri, name, type }.
  // Тип файла сервер определяет по байтам.
  form.append('photo', (await resolvePhoto(uri)) as unknown as Blob);
  return request<ServerMeal>('/v1/meals', { method: 'POST', body: form });
}

export const getMeal = (id: number) => request<ServerMeal>(`/v1/meals/${id}`);

/** День по Алматы: без даты — сегодня, иначе «2026-11-01». */
export const getToday = (date?: string) => request<ServerToday>(date ? `/v1/today?date=${date}` : '/v1/today');

/** Еда без фото из базы блюд; date — дописать в прошлый день (не дальше недели). */
export const addManualMeal = (items: { dish_id: string; grams: number }[], date?: string) =>
  request<ServerMeal>('/v1/meals/manual', { method: 'POST', ...json({ items, date }) });

export const deleteMeal = (id: number) => request<void>(`/v1/meals/${id}`, { method: 'DELETE' });

export const getProgress = () => request<ServerProgress>('/v1/progress');

export const searchDishes = (q: string) => request<DishHit[]>(`/v1/dishes?q=${encodeURIComponent(q)}`);

/** Что человек ест чаще всего за месяц — сверху списка «Добавить блюдо». */
export const recentDishes = () => request<DishHit[]>('/v1/dishes/recent');

export type ServerWeights = { points: { date: string; kg: number }[]; change: number | null };

export const getWeights = () => request<ServerWeights>('/v1/weights');

export const addWeight = (kg: number, date?: string) =>
  request<{ weights: ServerWeights; me: Me }>('/v1/weights', { method: 'POST', ...json({ kg, date }) });

export const putItems = (id: number, items: { dish_id: string; grams: number }[]) =>
  request<ServerMeal>(`/v1/meals/${id}/items`, { method: 'PUT', ...json({ items }) });

export const confirmMeal = (id: number) => request<ServerMeal>(`/v1/meals/${id}/confirm`, { method: 'POST' });

/** Все мои данные одним JSON (профиль, приёмы пищи, вес). */
export async function exportMe(): Promise<string> {
  await loadSession();
  const res = await fetch(`${BASE}/v1/users/me/export`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, 'Не получилось выгрузить данные. Попробуйте ещё раз.');
  return res.text();
}

export type Post = {
  id: number;
  kind: 'recipe' | 'habit';
  text: string;
  meal: { items: string[]; kcal: number; protein: number; has_photo: boolean } | null;
  at: string;
  author: string;
  mine: boolean;
  likes: number;
  liked: boolean;
  hidden: boolean;
  reports?: number;
};

export const getFeed = (kind?: Post['kind']) => request<{ posts: Post[] }>(kind ? `/v1/feed?kind=${kind}` : '/v1/feed');
export const addPost = (kind: Post['kind'], text: string, mealId?: number) =>
  request<Post>('/v1/feed', { method: 'POST', ...json({ kind, text, meal_id: mealId ?? null }) });
export const likePost = (id: number) => request<Post>(`/v1/feed/${id}/like`, { method: 'POST' });
export const reportPost = (id: number) => request<void>(`/v1/feed/${id}/report`, { method: 'POST' });
export const deletePost = (id: number) => request<void>(`/v1/feed/${id}`, { method: 'DELETE' });
export const getModeration = () => request<{ posts: Post[] }>('/v1/feed/moderation');
export const moderatePost = (id: number, keep: boolean) =>
  request<void>(`/v1/feed/${id}/moderate`, { method: 'POST', ...json({ keep }) });

export type Subscription = {
  status: 'trial' | 'active' | 'expired' | 'free';
  days_left?: number;
  until?: string;
  price_kzt: number;
  pay_url: string | null;
  pending: boolean;
  enforced: boolean;
};
export const getSubscription = () => request<Subscription>('/v1/subscription');
export const claimPayment = () => request<Subscription>('/v1/subscription/claim', { method: 'POST' });

export async function deleteMe() {
  await request<void>('/v1/users/me', { method: 'DELETE' });
  await clearSession();
}

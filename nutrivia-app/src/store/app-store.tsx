/**
 * Состояние приложения — кеш ответов сервера (nutrivia-bot/nutrivia/api.py).
 * Приёмы пищи, ориентиры, серия дней, стадия маскота и неделя приходят с сервера.
 */
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';

import {
  ApiError, getMe, getProgress, getToday, hasSession, setUnauthorizedHandler,
  type Me, type Role, type ServerItem, type ServerMeal, type ServerProgress, type ServerToday,
} from '@/api/client';

import { add, compute, getDish, ZERO, type Nutrients } from '@/engine/engine';
import type { MealStatus } from '@/components/status-pill';

export type Goal = 'lose' | 'muscle' | 'even' | 'coach';

export const GOALS: { id: Goal; title: string; sub: string; kcal: number | null; protein: number | null }[] = [
  { id: 'lose', title: 'Снизить вес', sub: 'Спокойно, без жёстких запретов', kcal: 1600, protein: 90 },
  { id: 'muscle', title: 'Набрать или сохранить мышцы', sub: 'Больше белка в каждом приёме', kcal: 2300, protein: 120 },
  { id: 'even', title: 'Питаться ровнее', sub: 'Без пропусков и переедания вечером', kcal: 2000, protein: 75 },
  { id: 'coach', title: 'По плану нутрициолога', sub: 'Ориентир задаст ваш специалист', kcal: null, protein: null },
];

/** Блюдо из базы пересчитывается локально тем же Engine; блюдо не из базы хранит цифры сервера. */
export type MealItem = { dishId: string | null; grams: number; name?: string; fixed?: Nutrients };
export type Meal = {
  id: string;
  serverId?: number;
  title: string;
  time: string;
  photo: string | null;
  items: MealItem[];
  status: MealStatus;
  /** кто проверил: trainer | nutritionist | operator */
  reviewerRole?: string | null;
};

export function itemsFromServer(items: ServerItem[]): MealItem[] {
  return items.map((i) => ({
    dishId: i.dish_id,
    grams: i.grams,
    name: i.name,
    fixed: i.dish_id ? undefined : { kcal: i.kcal ?? 0, protein: i.protein ?? 0, fat: i.fat ?? 0, carbs: i.carbs ?? 0 },
  }));
}

function mealFromServer(m: ServerMeal): Meal {
  const d = new Date((m.received_at ?? 0) * 1000);
  const names = m.items.map((i, j) => (j ? i.name.charAt(0).toLowerCase() + i.name.slice(1) : i.name));
  return {
    id: `s-${m.id}`,
    serverId: m.id,
    title: names.join(', ') || 'Приём пищи',
    time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    photo: m.has_photo ? `server:${m.id}` : null,
    items: itemsFromServer(m.items),
    status: m.status === 'reviewed' ? 'reviewed' : 'draft',
    reviewerRole: m.reviewer?.role ?? null,
  };
}

export type TaskId = 'breakfast' | 'lunch' | 'dinner' | 'advice';

type State = {
  /** false — ещё не проверили, есть ли сохранённая установка */
  booted: boolean;
  onboarded: boolean;
  /** первая загрузка дня с сервера прошла (успешно или нет) */
  loaded: boolean;
  goal: Goal;
  /** выбор на экранах регистрации до входа по SMS */
  signup: { role: Role; name: string; inviteCode: string };
  me: Me | null;
  meals: Meal[];
  serverTargets: { kcal: number; protein: number } | null;
  progress: ServerProgress | null;
  adviceDone: boolean;
};

type Action =
  | { type: 'setGoal'; goal: Goal }
  | { type: 'finishOnboarding' }
  | { type: 'addMeal'; meal: Meal }
  | { type: 'updateMeal'; id: string; patch: Partial<Meal> }
  | { type: 'boot'; onboarded: boolean }
  | { type: 'setToday'; today: ServerToday }
  | { type: 'setProgress'; progress: ServerProgress }
  | { type: 'setSignup'; patch: Partial<State['signup']> }
  | { type: 'setMe'; me: Me }
  | { type: 'loadFailed' }
  | { type: 'reset' }
  | { type: 'toggleAdvice' };

const initial: State = {
  booted: false,
  onboarded: false,
  loaded: false,
  goal: 'lose',
  signup: { role: 'client', name: '', inviteCode: '' },
  me: null,
  meals: [],
  serverTargets: null,
  progress: null,
  adviceDone: false,
};

function reducer(state: State, a: Action): State {
  switch (a.type) {
    case 'boot':
      return { ...state, booted: true, onboarded: a.onboarded };
    case 'setGoal':
      return { ...state, goal: a.goal };
    case 'finishOnboarding':
      return { ...state, onboarded: true };
    case 'addMeal':
      return { ...state, meals: [a.meal, ...state.meals.filter((m) => m.id !== a.meal.id)] };
    case 'updateMeal':
      return { ...state, meals: state.meals.map((m) => (m.id === a.id ? { ...m, ...a.patch } : m)) };
    case 'setToday':
      return { ...state, loaded: true, meals: a.today.meals.map(mealFromServer), serverTargets: a.today.targets };
    case 'setSignup':
      return { ...state, signup: { ...state.signup, ...a.patch } };
    case 'setMe': {
      const g = a.me.goal === 'coach_plan' ? 'coach' : a.me.goal;
      const goal = GOALS.some((x) => x.id === g) ? (g as Goal) : state.goal;
      return { ...state, me: a.me, goal };
    }
    case 'setProgress':
      return { ...state, progress: a.progress };
    case 'loadFailed':
      return { ...state, loaded: true };
    case 'reset':
      return { ...initial, booted: true };
    case 'toggleAdvice':
      return { ...state, adviceDone: !state.adviceDone };
  }
}

/** Задания дня: фото завтрака, обеда и ужина засчитываются по времени приёмов пищи. */
export function useTasks(): Record<TaskId, boolean> {
  const { state } = useAppStore();
  const hours = state.meals.map((m) => Number(m.time.slice(0, 2)));
  return {
    breakfast: hours.some((h) => h < 11),
    lunch: hours.some((h) => h >= 11 && h < 17),
    dinner: hours.some((h) => h >= 17),
    advice: state.adviceDone,
  };
}

export function mealNutrients(items: MealItem[]): Nutrients {
  return items.reduce((acc, i) => add(acc, i.dishId ? compute(getDish(i.dishId), i.grams) : (i.fixed ?? ZERO)), ZERO);
}

const Ctx = createContext<{ state: State; dispatch: (a: Action) => void } | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  }, [state]);

  // Запуск: есть сохранённая сессия — сразу внутрь (клиент на «Сегодня», специалист в кабинет)
  useEffect(() => {
    setUnauthorizedHandler(() => dispatch({ type: 'reset' }));
    hasSession().then(async (has) => {
      if (!has) return dispatch({ type: 'boot', onboarded: false });
      try {
        dispatch({ type: 'setMe', me: await getMe() });
      } catch (e) {
        // 401: сессия уже сброшена обработчиком — остаёмся на входе. Нет сети — войдём с тем, что есть
        if (e instanceof ApiError && e.status === 401) return;
      }
      dispatch({ type: 'boot', onboarded: true });
      refreshToday(dispatch);
    });
  }, []);

  // Пока есть разборы, ждущие нутрициолога, раз в 15 секунд обновляем день
  useEffect(() => {
    const timer = setInterval(() => {
      if (latest.current.me?.role === 'client' && latest.current.meals.some((m) => m.status === 'draft')) refreshToday(dispatch);
    }, 15000);
    return () => clearInterval(timer);
  }, []);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Обновляет день и прогресс (серия, неделя) с сервера. */
export function refreshToday(dispatch: (a: Action) => void) {
  return Promise.all([
    getToday().then(
      (today) => dispatch({ type: 'setToday', today }),
      () => dispatch({ type: 'loadFailed' }),
    ),
    getProgress().then(
      (progress) => dispatch({ type: 'setProgress', progress }),
      () => {},
    ),
  ]);
}

export function useAppStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAppStore outside AppStoreProvider');
  return ctx;
}

export function useTargets() {
  const { state } = useAppStore();
  // Ориентир с сервера главнее: его может поменять нутрициолог (/target в группе проверки)
  const g = GOALS.find((x) => x.id === state.goal)!;
  const kcal = state.serverTargets?.kcal ?? g.kcal ?? 2000;
  const protein = state.serverTargets?.protein ?? g.protein ?? 75;
  return { kcal, protein, carbs: Math.round((kcal * 0.5) / 4), fat: Math.round((kcal * 0.3) / 9) };
}

export function useToday() {
  const { state } = useAppStore();
  return state.meals.reduce((acc, m) => add(acc, mealNutrients(m.items)), ZERO);
}

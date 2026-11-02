// Личная норма — копия nutrivia-bot/nutrivia/advice.py (personal_targets): числа сверяют тесты обеих сторон.
// Здесь только для предпросмотра в онбординге; итоговый ориентир всегда приходит с сервера.

export type Sex = 'f' | 'm';
export type Activity = 'low' | 'light' | 'mid' | 'high';

export type Body = { sex: Sex; birthYear: number; heightCm: number; weightKg: number; activity: Activity };

const ACTIVITY: Record<Activity, number> = { low: 1.2, light: 1.375, mid: 1.55, high: 1.725 };
const GOAL_FACTOR: Record<string, number> = { lose: 0.85, muscle: 1.1, even: 1.0 };
const PROTEIN_PER_KG: Record<string, number> = { lose: 1.6, muscle: 1.8, even: 1.2 };
const MIN_KCAL: Record<Sex, number> = { f: 1200, m: 1500 };

// Python round() — банковское округление; на границе .5 ориентир может отличаться на 50 ккал, не страшно
export function personalTargets(b: Body, goal: string | null, year = new Date().getFullYear()) {
  const age = year - b.birthYear;
  const bmr = 10 * b.weightKg + 6.25 * b.heightCm - 5 * age + (b.sex === 'm' ? 5 : -161);
  const raw = bmr * ACTIVITY[b.activity] * (GOAL_FACTOR[goal ?? ''] ?? 1);
  const kcal = Math.max(MIN_KCAL[b.sex], Math.round(raw / 50) * 50);
  const protein = Math.round((b.weightKg * (PROTEIN_PER_KG[goal ?? ''] ?? 1.2)) / 5) * 5;
  return { kcal, protein };
}

export const ACTIVITIES: { id: Activity; title: string; sub: string }[] = [
  { id: 'low', title: 'Почти не двигаюсь', sub: 'Сидячая работа, без тренировок' },
  { id: 'light', title: 'Немного', sub: '1–2 тренировки или прогулки в неделю' },
  { id: 'mid', title: 'Активно', sub: '3–4 тренировки в неделю' },
  { id: 'high', title: 'Очень активно', sub: '5+ тренировок или физическая работа' },
];

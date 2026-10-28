/**
 * Мини-Engine: нутриенты считает только код, по базе, как per_100g × grams / 100.
 * Тот же расчёт, что в nutrivia-bot/nutrivia/engine.py — правила должны совпадать.
 */
import { DISHES } from './dishes.ts';

export type Dish = {
  id: string;
  nameRu: string;
  nameKk: string;
  synonyms: string[];
  category: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  unit: string;
  unitGrams: number;
  advice: boolean;
};

export type Nutrients = { kcal: number; protein: number; fat: number; carbs: number };

export const ZERO: Nutrients = { kcal: 0, protein: 0, fat: 0, carbs: 0 };

const byId = new Map(DISHES.map((d) => [d.id, d]));

export function getDish(id: string): Dish {
  const dish = byId.get(id);
  if (!dish) throw new Error(`Unknown dish: ${id}`);
  return dish;
}

export function compute(dish: Dish, grams: number): Nutrients {
  if (grams < 0) throw new Error('grams must be >= 0');
  const k = grams / 100;
  return { kcal: dish.kcal * k, protein: dish.protein * k, fat: dish.fat * k, carbs: dish.carbs * k };
}

export function add(a: Nutrients, b: Nutrients): Nutrients {
  return { kcal: a.kcal + b.kcal, protein: a.protein + b.protein, fat: a.fat + b.fat, carbs: a.carbs + b.carbs };
}

/** «1½» из 1.5 порции; порции идут шагом ½. */
export function portionCount(units: number): string {
  const halves = Math.round(units * 2) / 2;
  const whole = Math.floor(halves);
  const half = halves - whole === 0.5;
  return `${whole || ''}${half ? '½' : ''}` || '0';
}

/** Родительный падеж ед. и мн. числа для местных мер: «1½ пиалы», «5 пиал». */
const UNIT_FORMS: Record<string, [string, string]> = {
  пиала: ['пиалы', 'пиал'], тарелка: ['тарелки', 'тарелок'], штука: ['штуки', 'штук'], порция: ['порции', 'порций'],
  пачка: ['пачки', 'пачек'], кесе: ['кесе', 'кесе'], кусок: ['куска', 'кусков'], ломтик: ['ломтика', 'ломтиков'],
  стакан: ['стакана', 'стаканов'], четверть: ['четверти', 'четвертей'], шампур: ['шампура', 'шампуров'],
};

export function unitWord(unit: string, units: number): string {
  const forms = UNIT_FORMS[unit];
  if (!forms) return unit;
  const halves = Math.round(units * 2) / 2;
  if (halves % 1 !== 0) return forms[0];
  if (halves === 1) return unit;
  return halves >= 2 && halves <= 4 ? forms[0] : forms[1];
}

export function portionText(dish: Dish, grams: number): string {
  if (!dish.unitGrams) return `${Math.round(grams)} г`;
  const units = grams / dish.unitGrams;
  return `${portionCount(units)} ${unitWord(dish.unit, units)} · ≈${Math.round(grams)} г`;
}

/** Целые числа с пробелом по тысячам: 1 248. */
export function fmt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Холодильник: распознавание продуктов на сервере ещё не сделано — заглушка.
 * Разбор еды идёт через настоящий API (src/api/client.ts).
 */
import type { MealItem } from '@/store/app-store';

export type FridgeIdea = { name: string; from: string; items: MealItem[]; minutes: number; needs: string[] };

export async function analyzeFridgePhoto(_uri: string): Promise<string[]> {
  await new Promise((r) => setTimeout(r, 1200));
  return ['Яйца', 'Курица', 'Творог', 'Помидоры', 'Огурцы', 'Кефир', 'Гречка'];
}

/** Блюда из базы под продукты; порции — обычные. Правила, без LLM. */
export const FRIDGE_IDEAS: FridgeIdea[] = [
  { name: 'Куриная грудка с гречкой', from: 'курица 150 г, гречка 150 г', minutes: 25, needs: ['Курица', 'Гречка'],
    items: [{ dishId: 'chicken_breast', grams: 150 }, { dishId: 'buckwheat', grams: 150 }] },
  { name: 'Омлет с помидорами', from: '2 яйца, помидор', minutes: 10, needs: ['Яйца', 'Помидоры'],
    items: [{ dishId: 'omelet', grams: 110 }, { dishId: 'salad_veg', grams: 60 }] },
  { name: 'Творог с кефиром', from: 'творог 150 г, кефир 200 мл', minutes: 2, needs: ['Творог', 'Кефир'],
    items: [{ dishId: 'cottage_cheese', grams: 150 }, { dishId: 'kefir', grams: 200 }] },
  { name: 'Салат из свежих овощей', from: 'огурцы, помидоры', minutes: 5, needs: ['Огурцы', 'Помидоры'],
    items: [{ dishId: 'salad_veg', grams: 200 }] },
];

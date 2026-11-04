// Пересобирает src/engine/dishes.ts из nutrivia-bot/data/dishes.csv: node scripts/gen-dishes.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const csv = readFileSync(join(root, '../nutrivia-bot/data/dishes.csv'), 'utf8').trim().split('\n');
const head = csv[0].split(',');
const q = (s) => JSON.stringify(s);
const lines = csv.slice(1).map((line) => {
  const r = Object.fromEntries(line.split(',').map((v, i) => [head[i], v]));
  const syn = r.synonyms ? r.synonyms.split('|').map(q).join(',') : '';
  return `  { id: ${q(r.id)}, nameRu: ${q(r.name_ru)}, nameKk: ${q(r.name_kk)}, synonyms: [${syn}], category: ${q(r.category)}, `
    + `kcal: ${+r.kcal}, protein: ${+r.protein}, fat: ${+r.fat}, carbs: ${+r.carbs}, unit: ${q(r.unit)}, unitGrams: ${+r.unit_grams}, advice: ${r.advice === '1'} },`;
});
writeFileSync(join(root, 'src/engine/dishes.ts'), [
  '// Сгенерировано из nutrivia-bot/data/dishes.csv — черновая база, значения на 100 г. Не править вручную.',
  'import type { Dish } from "./engine.ts";', '', 'export const DISHES: Dish[] = [', ...lines, '];', ''].join('\n'));
console.log(`dishes.ts: ${lines.length} блюд`);

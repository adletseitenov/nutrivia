// Запуск: node --experimental-strip-types src/engine/engine.test.ts
import assert from 'node:assert/strict';

import { compute, fmt, getDish, portionText } from './engine.ts';
import { personalTargets } from './targets.ts';

const n = compute(getDish('chicken_breast'), 150);
assert.equal(Math.round(n.kcal), 248);
assert.equal(Math.round(n.protein * 10) / 10, 46.5);
assert.equal(Math.round(n.fat * 10) / 10, 5.4);
assert.equal(n.carbs, 0);
assert.equal(portionText(getDish('plov'), 450), '1½ пиалы · ≈450 г');
assert.equal(portionText(getDish('plov'), 300), '1 пиала · ≈300 г');
assert.equal(portionText(getDish('plov'), 1500), '5 пиал · ≈1500 г');
assert.equal(portionText(getDish('tea_milk'), 200), '1 кесе · ≈200 г');
assert.equal(fmt(1248), '1 248');
assert.throws(() => compute(getDish('plov'), -1));
// Те же числа, что в tests/test_advice.py сервера
const woman = { sex: 'f', birthYear: 1996, heightCm: 165, weightKg: 70, activity: 'light' } as const;
assert.deepEqual(personalTargets(woman, 'even', 2026), { kcal: 1950, protein: 85 });
assert.deepEqual(personalTargets(woman, 'lose', 2026), { kcal: 1650, protein: 110 });
assert.deepEqual(personalTargets({ sex: 'm', birthYear: 2001, heightCm: 180, weightKg: 80, activity: 'mid' }, 'muscle', 2026), { kcal: 3100, protein: 145 });
assert.equal(personalTargets({ sex: 'f', birthYear: 1966, heightCm: 150, weightKg: 45, activity: 'low' }, 'lose', 2026).kcal, 1200);
console.log('engine ok: 150 г курицы = 248 ккал / 46,5 Б / 5,4 Ж');

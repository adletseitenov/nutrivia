// Запуск: node --experimental-strip-types src/engine/engine.test.ts
import assert from 'node:assert/strict';

import { compute, fmt, getDish, portionText } from './engine.ts';

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
console.log('engine ok: 150 г курицы = 248 ккал / 46,5 Б / 5,4 Ж');

// Скрины экранов для показа: 9 экранов × светлая/тёмная тема, 1170×2532 (iPhone, ×3).
// Нужен сервер на 8001 с демо (DEMO_NOW=…T17:10 python -m scripts.demo_seed --reset) и токен клиента в /tmp/nv-token.
// Часы браузера — 17:10 по Алматы: «Совет на вечер», завтрак и обед уже записаны.
import { chromium } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8001', OUT = '../screenshots', token = readFileSync('/tmp/nv-token', 'utf8');
const NOW = new Date(process.env.SHOT_TIME || '2026-11-05T17:10:00+05:00');
const plov = readdirSync('../nutrivia-app/dist/assets/assets/images').find((f) => f.startsWith('demo-plov'));
const photo = encodeURIComponent('/assets/assets/images/' + plov);
const me = await (await fetch(BASE + '/v1/me', { headers: { Authorization: `Bearer ${token}` } })).json();
const stage = (await (await fetch(BASE + '/v1/progress', { headers: { Authorization: `Bearer ${token}` } })).json()).streak;

const browser = await chromium.launch();
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: scheme,
    isMobile: true, hasTouch: true, locale: 'ru-RU', timezoneId: 'Asia/Almaty' });
  await ctx.clock.setFixedTime(NOW);
  // стадию «уже видели» — иначе на «Сегодня» сам выскочит экран «Новая стадия»
  await ctx.addInitScript(([t, key, s]) => { localStorage.setItem('nutrivia.session', t); localStorage.setItem(key, s); },
    [token, `nutrivia.stage.${me.user_id}`, String(stage.stage)]);
  // Разбор фото на самом деле создаёт приём пищи: на скрине — дневной вид (без «сейчас ночь»), после — удаляем
  const created = [];
  await ctx.route('**/v1/meals', async (r) => {
    if (r.request().method() !== 'POST') return r.continue();
    const res = await r.fetch(); const body = await res.json();
    if (body.id) created.push(body.id);
    await r.fulfill({ response: res, json: { ...body, night: false } });
  });
  const p = await ctx.newPage();
  const v = (s) => p.getByText(s, { exact: false }).filter({ visible: true }).first();
  const shot = async (name) => { await p.waitForTimeout(1300); await p.screenshot({ path: `${OUT}/${scheme}-${name}.png` }); };

  await p.goto(BASE + '/today'); await v('Совет на вечер').waitFor(); await shot('1-glavnyj');
  await v('Совет на вечер').scrollIntoViewIfNeeded(); await p.mouse.wheel(0, 220); await shot('2-sovet-na-vecher');
  await p.goto(BASE + '/review?photo=' + photo); await v('Плов с говядиной').waitFor({ timeout: 20000 }); await shot('3-ii-razbor-foto');
  for (const id of created.splice(0)) await fetch(`${BASE}/v1/meals/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  await p.goto(BASE + '/fridge?photo=' + photo); await v('Куриная грудка с гречкой').waitFor({ timeout: 20000 }); await shot('4-podbor-blyud-holodilnik');
  await p.goto(BASE + '/streak'); await v('дней подряд').waitFor(); await shot('5-seriya-golubika');
  await p.goto(BASE + `/stage-up?stage=${stage.stage}&days=${stage.days}`); await v('Голубика выросла').waitFor(); await p.waitForTimeout(1500); await shot('6-novaya-stadiya');
  await p.goto(BASE + '/progress'); await v('Прогресс').waitFor(); await shot('7-progress');
  await p.goto(BASE + '/feed'); await v('Лента').waitFor(); await shot('8-lenta');
  await p.goto(BASE + '/profile'); await v('Уведомления в Telegram').waitFor(); await shot('9-profil-telegram');
  await ctx.close();
}
await browser.close();
console.log('готово:', OUT);

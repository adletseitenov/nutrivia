// Записи экранов для лаунч-видео: iPhone 1170×2532, тёмная тема, настоящий ИИ (сервер tools/server_at.py на 8002).
//   cd e2e && node ../launch-video/tools/footage.mjs [клип]   → launch-video/public/media/clips/<клип>.mp4
// Токены: /tmp/nv-launch-client, /tmp/nv-launch-trainer. Стоковые фото — в nutrivia-app/dist/stock/.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../public/media/clips');
const BASE = 'http://127.0.0.1:8002';
const NOW = new Date('2026-11-05T19:20:00+05:00');
const client = readFileSync('/tmp/nv-launch-client', 'utf8').trim();
const trainer = readFileSync('/tmp/nv-launch-trainer', 'utf8').trim();
const only = process.argv[2];
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

const api = async (path, token) => (await fetch(BASE + path, { headers: { Authorization: `Bearer ${token}` } })).json();
const me = await api('/v1/me', client);
const streak = (await api('/v1/progress', client)).streak;

const TAPS = () => {
  addEventListener('pointerdown', (e) => {
    const d = document.createElement('div');
    Object.assign(d.style, { position: 'fixed', left: e.clientX - 24 + 'px', top: e.clientY - 24 + 'px', width: '48px', height: '48px',
      borderRadius: '50%', background: 'rgba(255,255,255,.28)', border: '2px solid rgba(255,255,255,.85)', pointerEvents: 'none',
      zIndex: 99999, transition: 'transform .45s ease-out, opacity .45s ease-out' });
    document.body.appendChild(d);
    requestAnimationFrame(() => { d.style.transform = 'scale(1.7)'; d.style.opacity = '0'; });
    setTimeout(() => d.remove(), 600);
  }, true);
};

async function clip(name, token, fn) {
  if (only && only !== name) return;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: 'dark',
    isMobile: true, hasTouch: true, locale: 'ru-RU' });
  await ctx.clock.setFixedTime(NOW);
  await ctx.addInitScript(([t, key, s]) => {
    localStorage.setItem('nutrivia.session', t);
    if (!localStorage.getItem(key)) localStorage.setItem(key, s);
  }, [token, `nutrivia.stage.${me.user_id}`, String(streak.stage)]);
  await ctx.addInitScript(TAPS);
  // ночная плашка в записи не нужна
  await ctx.route('**/v1/meals', async (r) => {
    if (r.request().method() !== 'POST') return r.continue();
    const res = await r.fetch(); const body = await res.json();
    await r.fulfill({ response: res, json: { ...body, night: false } });
  });
  const p = await ctx.newPage();
  const dir = `${OUT}/raw-${name}`;
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const cdp = await ctx.newCDPSession(p);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const f = `${String(frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(`${dir}/${f}`, Buffer.from(data, 'base64'));
    frames.push({ f, t: metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: 1170, maxHeight: 2532 });

  const v = (s) => p.getByText(s, { exact: true }).filter({ visible: true }).first();
  const tap = async (loc) => { await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox(); await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
  const wait = (ms) => p.waitForTimeout(ms);
  const scrollTo = (loc, block = 'center') => loc.evaluate((el, b) => el.scrollIntoView({ behavior: 'smooth', block: b }), block);
  const scrollBy = (y) => p.evaluate((dy) => {
    const els = [...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(e).overflowY));
    (els.sort((a, b) => b.clientHeight - a.clientHeight)[0] || window).scrollBy({ top: dy, behavior: 'smooth' });
  }, y);
  let startAt = 0;
  const ready = () => { startAt = Date.now() / 1000; };
  const marks = [];
  const mark = (label) => marks.push([label, +(Date.now() / 1000 - startAt).toFixed(2)]);
  await fn({ p, v, tap, wait, scrollTo, scrollBy, ready, mark });
  await wait(500);
  const end = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  await ctx.close();

  const first = Math.max(0, frames.findLastIndex((fr) => fr.t <= startAt));
  const use = frames.slice(first).map((fr, i) => (i === 0 ? { ...fr, t: Math.max(fr.t, startAt) } : fr));
  const lines = use.map((fr, i) => `file '${fr.f}'\nduration ${Math.max(0.02, (use[i + 1]?.t ?? end) - fr.t).toFixed(3)}`);
  writeFileSync(`${dir}/list.txt`, `${lines.join('\n')}\nfile '${use.at(-1).f}'\n`);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', `${dir}/list.txt`,
    '-vf', 'scale=1170:2532:force_original_aspect_ratio=decrease,pad=1170:2532:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p',
    '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-movflags', '+faststart', `${OUT}/${name}.mp4`]);
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify({ duration: +(end - startAt).toFixed(2), marks }, null, 1));
  rmSync(dir, { recursive: true, force: true });
  console.log('clip', name, (end - startAt).toFixed(1) + 's', JSON.stringify(marks));
}

// 1. Фото → настоящий разбор ИИ
await clip('review', client, async ({ p, v, wait, scrollBy, ready, mark }) => {
  await p.goto(BASE + '/review?photo=' + encodeURIComponent('/stock/plov2.jpg')); ready(); mark('analyzing');
  await v('Плов с говядиной').waitFor({ timeout: 60000 }); mark('result');
  await wait(2500); scrollBy(420); await wait(2200); mark('scrolled'); scrollBy(-420); await wait(1200);
});

// 2. Тренер: новое фото в очереди → проверка → «Отправить»
await clip('trainer', trainer, async ({ p, v, tap, wait, scrollTo, ready, mark }) => {
  await p.goto(BASE + '/pro'); await v('Ждут проверки').waitFor(); await wait(900); ready(); mark('cabinet');
  await wait(1500); await scrollTo(v('Ждут проверки'), 'start'); await wait(1600); mark('queue');
  await tap(p.getByText('Плов с говядиной').filter({ visible: true }).first()); mark('open');
  await p.getByText(/^Отправить/).filter({ visible: true }).first().waitFor(); await wait(2200);
  await tap(p.getByText(/^Отправить/).filter({ visible: true }).first()); mark('sent'); await wait(2200);
});

// 3. «Сегодня» → «Совет на вечер»
await clip('today', client, async ({ p, v, wait, scrollTo, ready, mark }) => {
  await p.goto(BASE + '/today'); await v('Сегодня').waitFor(); await wait(1200); ready(); mark('today');
  await wait(2000); await scrollTo(v('Совет на вечер')); mark('advice'); await wait(3000);
});

// 4. Холодильник: фото продуктов → блюда из базы
await clip('fridge', client, async ({ p, v, wait, scrollTo, ready, mark }) => {
  await p.goto(BASE + '/fridge?photo=' + encodeURIComponent('/stock/products.jpg')); ready(); mark('analyzing');
  await v('Омлет на молоке').waitFor({ timeout: 60000 }); mark('ideas'); await wait(1800);
  await scrollTo(v('Омлет на молоке')); await wait(2600);
});

// 5. Серия и голубика
await clip('streak', client, async ({ p, v, tap, wait, ready, mark }) => {
  await p.goto(BASE + '/today'); await v('Сегодня').waitFor(); await wait(900); ready();
  await wait(900); await tap(p.getByLabel(/^Серия/).filter({ visible: true })); mark('tap');
  await p.getByText('дней подряд').filter({ visible: true }).first().waitFor(); mark('streak'); await wait(3500);
});

// 6. Новая стадия
await clip('stageup', client, async ({ p, v, wait, ready, mark }) => {
  await p.goto(BASE + `/stage-up?stage=${streak.stage}&days=${streak.days}`); ready(); mark('open');
  await p.getByText(/Голубика выросла/).filter({ visible: true }).first().waitFor(); await wait(3200);
});

// 7. Прогресс → лента
await clip('progress', client, async ({ p, v, tap, wait, scrollTo, ready, mark }) => {
  await p.goto(BASE + '/progress'); await v('Прогресс').waitFor(); await wait(900); ready(); mark('progress');
  await wait(1800); await scrollTo(p.getByText('Вес', { exact: true }).filter({ visible: true }).first()); await wait(1800);
  await tap(v('Лента')); mark('feed'); await wait(2600);
});

await browser.close();

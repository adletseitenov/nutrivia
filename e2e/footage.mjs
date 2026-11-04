// Футаж для лаунч-видео: экраны в размере iPhone (1170×2532), светлая тема, точка на месте нажатия.
// Нужен запущенный сервер на 8001 с демо-данными (scripts/demo_seed.py) и токен клиента в /tmp/nv-token.
//   node footage.mjs [имя-клипа]   → ../footage/<клип>.mp4
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8001', OUT = '../footage', token = readFileSync('/tmp/nv-token', 'utf8');
const plov = '/' + readdirSync('../nutrivia-app/dist/assets/assets/images').filter((f) => f.startsWith('demo-plov'))
  .map((f) => 'assets/assets/images/' + f)[0];
const photo = encodeURIComponent(plov);
const only = process.argv[2];
const browser = await chromium.launch();

const TAPS = () => {
  addEventListener('pointerdown', (e) => {
    const d = document.createElement('div');
    Object.assign(d.style, { position: 'fixed', left: e.clientX - 22 + 'px', top: e.clientY - 22 + 'px', width: '44px', height: '44px',
      borderRadius: '50%', background: 'rgba(107,78,255,.35)', border: '2px solid rgba(107,78,255,.8)', pointerEvents: 'none',
      zIndex: 99999, transition: 'transform .45s ease-out, opacity .45s ease-out' });
    document.body.appendChild(d);
    requestAnimationFrame(() => { d.style.transform = 'scale(1.6)'; d.style.opacity = '0'; });
    setTimeout(() => d.remove(), 600);
  }, true);
};

async function clip(name, fn) {
  if (only && only !== name) return;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: 'light',
    isMobile: true, hasTouch: true, locale: 'ru-RU' });
  await ctx.addInitScript((t) => localStorage.setItem('nutrivia.session', t), token);
  await ctx.addInitScript(TAPS);
  // Тестовый ИИ отвечает мгновенно — для кадра показываем «Разбираем фото…» пару секунд; ночную плашку убираем
  await ctx.route('**/v1/meals', async (r) => {
    if (r.request().method() !== 'POST') return r.continue();
    const res = await r.fetch(); const body = await res.json();
    await new Promise((ok) => setTimeout(ok, 2600));
    await r.fulfill({ response: res, json: { ...body, night: false } });
  });
  await ctx.route('**/v1/fridge', async (r) => {
    const res = await r.fetch(); await new Promise((ok) => setTimeout(ok, 2600)); await r.fulfill({ response: res });
  });
  const p = await ctx.newPage();

  // Кадры через CDP-скринкаст — в полном разрешении экрана (×3), recordVideo пишет только CSS-пиксели
  const dir = `${OUT}/raw/${name}`;
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const cdp = await ctx.newCDPSession(p);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const f = `${String(frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(`${dir}/${f}`, Buffer.from(data, 'base64'));
    frames.push({ f, t: metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1170, maxHeight: 2532 });

  const v = (s) => p.getByText(s, { exact: true }).filter({ visible: true }).first();
  const tap = async (loc) => {
    await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox();
    await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  };
  const wait = (ms) => p.waitForTimeout(ms);
  const scrollTo = (loc, block = 'center') => loc.evaluate((el, b) => el.scrollIntoView({ behavior: 'smooth', block: b }), block);
  let startAt = 0;
  const ready = () => { startAt = Date.now() / 1000; }; // клип начинается с загруженного экрана
  await fn({ p, v, tap, wait, scrollTo, ready });

  await wait(400);
  const end = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  await ctx.close();

  // Кадры приходят только при изменениях экрана: каждый держим до следующего
  const first = Math.max(0, frames.findLastIndex((fr) => fr.t <= startAt));
  const use = frames.slice(first).map((fr, i) => (i === 0 ? { ...fr, t: Math.max(fr.t, startAt) } : fr));
  const lines = use.map((fr, i) => `file '${fr.f}'\nduration ${Math.max(0.02, (use[i + 1]?.t ?? end) - fr.t).toFixed(3)}`);
  writeFileSync(`${dir}/list.txt`, `${lines.join('\n')}\nfile '${use.at(-1).f}'\n`);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', `${dir}/list.txt`,
    '-vf', 'scale=1170:2532:force_original_aspect_ratio=decrease,pad=1170:2532:(ow-iw)/2:(oh-ih)/2:white,fps=30,format=yuv420p',
    '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', `${OUT}/${name}.mp4`]);
  console.log('clip', name, use.length, 'кадров');
}

await clip('1-foto-razbor', async ({ p, v, tap, wait, scrollTo, ready }) => {
  await p.goto(BASE + '/today'); await v('Сегодня').waitFor(); await wait(800); ready(); await wait(2000);
  await p.goto(BASE + '/review?photo=' + photo); await wait(300);
  await v('Плов с говядиной').waitFor({ timeout: 20000 }); await wait(2000);
  await tap(p.getByLabel('Больше').filter({ visible: true }).first()); await wait(1500);
  await tap(v('Верно')); await v('Сегодня').waitFor(); await wait(2500);
  await scrollTo(v('Совет на вечер')); await wait(2200);
  await tap(p.getByLabel(/^Записать: /).filter({ visible: true }).first()); await wait(1500);
  await scrollTo(v('Сегодня'), 'start'); await wait(2500);
});

await clip('2-holodilnik', async ({ p, v, tap, wait, scrollTo, ready }) => {
  await p.goto(BASE + '/fridge?photo=' + photo); await v('Что приготовить').waitFor(); await wait(300); ready();
  await v('Куриная грудка с гречкой').waitFor({ timeout: 20000 }); await wait(2200);
  await tap(p.getByLabel('Убрать: курица').filter({ visible: true })); await wait(2000);
  await scrollTo(v('Съел')); await wait(1200);
  await tap(v('Съел')); await wait(2500);
});

await clip('3-seriya', async ({ p, v, tap, wait, ready }) => {
  await p.goto(BASE + '/today'); await v('Сегодня').waitFor(); await wait(800); ready(); await wait(1500);
  await tap(p.getByLabel(/^Серия/).filter({ visible: true }));
  await p.getByText('дней подряд').filter({ visible: true }).first().waitFor(); await wait(3500);
});

await clip('4-progress-lenta', async ({ p, v, tap, wait, scrollTo, ready }) => {
  await p.goto(BASE + '/progress'); await v('Прогресс').waitFor(); await wait(800); ready(); await wait(2500);
  await scrollTo(p.getByText('Вес', { exact: true }).filter({ visible: true }).first()); await wait(2000);
  await tap(v('Лента')); await wait(3000);
});

await browser.close();

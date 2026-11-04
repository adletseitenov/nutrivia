import { chromium } from '@playwright/test';
const BASE = 'http://127.0.0.1:8001', OUT = '../screenshots', token = (await import('node:fs')).readFileSync('/tmp/nv-token', 'utf8');
const photo = encodeURIComponent('/assets/assets/images/demo-plov.366839dde17214cf5bddb4906412aeaf.png');
const browser = await chromium.launch();
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: scheme, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  await ctx.addInitScript((t) => localStorage.setItem('nutrivia.session', t), token);
  const p = await ctx.newPage();
  const shot = async (name) => { await p.waitForTimeout(1200); await p.screenshot({ path: `${OUT}/${scheme}-${name}.png` }); };
  await p.goto(BASE + '/today'); await p.getByText('Совет на вечер').first().waitFor(); await shot('1-glavnyj');
  await p.getByText('Совет на вечер').filter({ visible: true }).first().scrollIntoViewIfNeeded();
  await p.mouse.wheel(0, 200); await shot('2-sovet-na-vecher');
  await p.goto(BASE + '/review?photo=' + photo); await p.getByText('Плов с говядиной').filter({ visible: true }).first().waitFor({ timeout: 20000 }); await shot('3-ii-razbor-foto');
  await p.goto(BASE + '/fridge?photo=' + photo); await p.getByText('Куриная грудка с гречкой').filter({ visible: true }).first().waitFor({ timeout: 20000 }); await shot('4-podbor-blyud-holodilnik');
  await p.goto(BASE + '/streak'); await p.getByText('дней подряд').filter({ visible: true }).first().waitFor(); await shot('5-seriya-golubika');
  await p.goto(BASE + '/progress'); await shot('6-progress');
  await p.goto(BASE + '/feed'); await shot('7-lenta');
  await ctx.close();
}
await browser.close();

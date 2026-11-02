import { expect, test } from '@playwright/test';

import { login, makeOperator, screen, signupClient } from './helpers';

const PLOV = `${__dirname}/../../nutrivia-app/assets/images/demo-plov.png`;

test('клиент: регистрация с личной нормой, ручной ввод и удаление', async ({ page }) => {
  await signupClient(page, '+77005550101');
  await expect(page.getByText('Съедено 0 из 1 650 ккал по записанному').filter({ visible: true }).first()).toBeVisible();

  await page.getByText('+ Без фото').filter({ visible: true }).click();
  await page.getByLabel('Поиск блюда').filter({ visible: true }).fill('овсянка');
  await page.getByText('Овсянка на воде').filter({ visible: true }).click();
  await page.getByText(/^Записать · 220 ккал$/).filter({ visible: true }).click();
  await expect(page.getByText('Записано вручную').filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText('Съедено 220 из 1 650 ккал по записанному').filter({ visible: true }).first()).toBeVisible();

  page.on('dialog', (d) => d.accept());
  await page.getByText('Овсянка на воде').filter({ visible: true }).click();
  await page.getByText('Удалить приём пищи').filter({ visible: true }).click();
  await expect(page.getByText('Съедено 0 из 1 650 ккал по записанному').filter({ visible: true }).first()).toBeVisible();
});

test('клиент: вес пересчитывает норму и рисует линию', async ({ page }) => {
  await signupClient(page, '+77005550102');
  await screen(page, 'Сегодня');
  await page.getByText('Прогресс', { exact: true }).filter({ visible: true }).click();
  await expect(page.getByText('Записать вес').filter({ visible: true }).first()).toBeVisible();
  await page.getByText('Записать вес').filter({ visible: true }).first().click();
  await page.getByLabel('Вес, кг').filter({ visible: true }).fill('68');
  await page.getByText('Сохранить', { exact: true }).filter({ visible: true }).click();
  await expect(page.getByText('68 кг', { exact: true }).filter({ visible: true }).first()).toBeVisible();
});

test('фото → черновик → оператор проверяет → клиент видит «Проверено»', async ({ browser }) => {
  const client = await browser.newPage();
  await signupClient(client, '+77005550103');
  await screen(client, 'Сегодня');
  await client.getByLabel('Сфотографировать еду').filter({ visible: true }).click();
  await screen(client, 'Сфотографируйте еду');
  const chooser = client.waitForEvent('filechooser');
  await client.getByLabel('Выбрать из галереи').filter({ visible: true }).click();
  await (await chooser).setFiles(PLOV);
  await expect(client.getByText('Плов с говядиной').filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
  await client.getByText('Верно', { exact: true }).filter({ visible: true }).click();
  await expect(client).toHaveURL(/\/today/);
  await expect(client.getByText('Оценка по фото').filter({ visible: true }).first()).toBeVisible();

  makeOperator('+77005550199');
  const op = await browser.newPage();
  await login(op, '+77005550199');
  await expect(op.getByText('Кабинет оператора').filter({ visible: true }).first()).toBeVisible();
  await op.getByText(/^Клиент \d+: плов/).filter({ visible: true }).click();
  await op.getByText('Добавьте белок на ужин').filter({ visible: true }).click();
  await op.getByText('Отправить клиенту').filter({ visible: true }).click();
  await expect(op.getByText('Все разборы проверены.').filter({ visible: true }).first()).toBeVisible();

  await client.reload();
  await expect(client.getByText('Проверено нутрициологом').filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
});

test('холодильник: продукты → блюда под остаток дня → «Съел» записывает в день', async ({ page }) => {
  await signupClient(page, '+77005550104');
  await screen(page, 'Сегодня');
  await page.getByLabel('Сфотографировать еду').filter({ visible: true }).click();
  await screen(page, 'Сфотографируйте еду');
  await page.getByText('Холодильник', { exact: true }).filter({ visible: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByLabel('Выбрать из галереи').filter({ visible: true }).click();
  await (await chooser).setFiles(PLOV);
  await expect(page.getByText('Куриная грудка с гречкой').filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
  // убрали курицу — блюда с ней пропали
  await page.getByLabel('Убрать: курица').filter({ visible: true }).click();
  await expect(page.getByText('Куриная грудка с гречкой').filter({ visible: true })).toHaveCount(0);
  await page.getByText('Съел', { exact: true }).filter({ visible: true }).first().click();
  await expect(page.getByText('Записано', { exact: true }).filter({ visible: true }).first()).toBeVisible();
});

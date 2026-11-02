import { execFileSync } from 'node:child_process';

import { expect, type Page } from '@playwright/test';

import { DB } from '../playwright.config';

const BOT = `${__dirname}/../../nutrivia-bot`;
const ENV = { ...process.env, DB_PATH: DB, AUTH_SECRET: 'e2e-secret' };

/** Код входа, как его выдаёт команда пилота (scripts/pilot_code). */
export function issueCode(phone: string): string {
  const out = execFileSync(`${BOT}/.venv/bin/python`, ['-m', 'scripts.pilot_code', phone], { cwd: BOT, env: ENV }).toString();
  const m = out.match(/код входа: (\d{4})/);
  if (!m) throw new Error(`нет кода в выводе: ${out}`);
  return m[1];
}

/** Сделать номер оператором (scripts/make_operator). */
export function makeOperator(phone: string) {
  execFileSync(`${BOT}/.venv/bin/python`, ['-m', 'scripts.make_operator', phone], { cwd: BOT, env: ENV });
}

/** Ждём экран по заголовку: переходы в вебе анимированы, прошлый экран какое-то время ещё в DOM. */
export async function screen(page: Page, title: string) {
  await expect(page.getByText(title, { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await page.waitForTimeout(400);
}

/** На экране с заголовком title нажать «Продолжить». */
async function next(page: Page, title: string) {
  await screen(page, title);
  await page.getByText('Продолжить', { exact: true }).filter({ visible: true }).last().click();
}

/** «+77…» → 10 цифр после +7 для поля номера. */
const local = (phone: string) => phone.replace(/\D/g, '').slice(1);

export async function enterPhoneAndCode(page: Page, phone: string) {
  const code = issueCode(phone);
  await page.getByLabel('Номер телефона').filter({ visible: true }).fill(local(phone));
  await page.getByText('Получить код', { exact: true }).filter({ visible: true }).click();
  await expect(page.getByText('Код входа', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await page.keyboard.type(code);
}

/** Регистрация клиента «для себя» с параметрами — до экрана «Сегодня». */
export async function signupClient(page: Page, phone: string) {
  await page.goto('/');
  await page.getByText('Начать', { exact: true }).filter({ visible: true }).click();
  await next(page, 'Кто вы?'); // роль: для себя
  await next(page, 'Какая у вас цель?'); // цель: снизить вес
  await screen(page, 'Немного о вас');
  await page.getByRole('radio', { name: 'Женщина' }).filter({ visible: true }).click();
  await page.getByLabel('Год рождения').filter({ visible: true }).fill('1996');
  await page.getByLabel('Рост, см').filter({ visible: true }).fill('165');
  await page.getByLabel('Вес, кг').filter({ visible: true }).fill('70');
  await page.getByRole('radio', { name: /^Немного/ }).filter({ visible: true }).click();
  await expect(page.getByText('1 650 ккал · белок 110 г').filter({ visible: true }).first()).toBeVisible();
  await page.getByText('Продолжить', { exact: true }).filter({ visible: true }).last().click();
  await screen(page, 'Ваш номер телефона');
  await enterPhoneAndCode(page, phone);
  await expect(page).toHaveURL(/\/today/);
}

export async function login(page: Page, phone: string) {
  await page.goto('/');
  await page.getByText('Войти', { exact: true }).filter({ visible: true }).click();
  await screen(page, 'Вход');
  await enterPhoneAndCode(page, phone);
}

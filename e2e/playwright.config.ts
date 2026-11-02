import { defineConfig, devices } from '@playwright/test';

/**
 * Сквозные тесты на веб-версии: настоящий сервер (FastAPI) с тестовым распознаванием (fake),
 * входом по кодам от команды (manual) и чистой базой на каждый прогон.
 * Перед запуском: `npx expo export -p web --output-dir dist` в nutrivia-app.
 *   cd e2e && npx playwright test
 */
const PORT = 8011;
const BOT = '../nutrivia-bot';
export const DB = `${process.env.TMPDIR ?? '/tmp'}/nutrivia-e2e.db`;

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['iPhone 13'],
    browserName: 'chromium',
    locale: 'ru-RU',
    timezoneId: 'Asia/Almaty',
    colorScheme: 'light',
  },
  webServer: {
    command:
      `rm -f ${DB} && cd ${BOT} && VISION_PROVIDER=fake SMS_PROVIDER=manual AUTH_SECRET=e2e-secret DB_PATH=${DB}` +
      ` PHOTOS_DIR=${DB}-photos WEB_DIR=../nutrivia-app/dist PORT=${PORT} .venv/bin/python -m nutrivia.api`,
    url: `http://localhost:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

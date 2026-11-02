# Nutrivia

Фото еды → калории и БЖУ → проверка нутрициологом или тренером.

- [`nutrivia-app`](nutrivia-app) — мобильное приложение (Expo / React Native).
- [`nutrivia-bot`](nutrivia-bot) — сервер: API для приложения (FastAPI), Telegram-бот, распознавание фото (OpenRouter или Claude), база блюд. Запуск пилота — раздел «Пилот с Мака» в его README.

Ключи и настройки — только в `nutrivia-bot/.env` (пример: `.env.example`), в репозиторий не попадают.

Проверки: `nutrivia-bot` — `.venv/bin/python -m pytest`; `nutrivia-app` — `npx tsc --noEmit && npx eslint src && npm run test:engine`;
сквозные сценарии в браузере — `cd e2e && npm install && npx playwright install chromium && npm test`
(регистрация с нормой, ручной ввод и удаление, вес, фото → проверка оператором → «Проверено»).

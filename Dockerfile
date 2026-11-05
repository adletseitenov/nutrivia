# Nutrivia одним сервисом (Railway и любой Docker-хостинг): веб-версия + API на одном адресе.
# Том подключить в /data — там база и фото. Переменные — см. DEPLOY.md.

# 1) Веб-версия приложения (Expo → статический сайт)
FROM node:24-slim AS web
WORKDIR /app
COPY nutrivia-app/package.json nutrivia-app/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY nutrivia-app/ ./
RUN npx expo export -p web --output-dir /web

# 2) Сервер
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
COPY nutrivia-bot/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY nutrivia-bot/nutrivia nutrivia
COPY nutrivia-bot/scripts scripts
COPY nutrivia-bot/data/dishes.csv seed/dishes.csv
COPY nutrivia-app/assets/images/demo-plov.png seed/demo-plov.png
COPY --from=web /web /web
ENV DB_PATH=/data/nutrivia.db PHOTOS_DIR=/data/photos DISHES_CSV=/app/seed/dishes.csv WEB_DIR=/web \
    DEMO_PHOTO=/app/seed/demo-plov.png PORT=8000 TRUST_PROXY=1
EXPOSE 8000
# TRUST_PROXY=1 — образ работает за прокси Railway: адрес клиента и https берём из его заголовков.
# DEMO_SEED=1 — при старте один раз создать демо-аккаунты (если их ещё нет);
# DEMO_SEED=reset — пересоздавать их при каждом старте: неделя заканчивается сегодняшним днём.
# timeout — что бы ни случилось с демо-скриптом, сервер всё равно стартует.
CMD ["sh", "-c", "mkdir -p /data && case \"$DEMO_SEED\" in reset) timeout 300 python -m scripts.demo_seed --reset || true;; ?*) timeout 300 python -m scripts.demo_seed || true;; esac; exec python -m nutrivia.api"]

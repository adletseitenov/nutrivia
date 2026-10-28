#!/usr/bin/env bash
# Пилот с Мака: API + веб-версия приложения на одном адресе, наружу через бесплатный туннель Cloudflare.
# Участники открывают ссылку в браузере телефона: Expo Go на iPhone не пускает в проект чужого аккаунта.
# Настройки и ключи — в nutrivia-bot/.env. Остановить — Ctrl+C (гасит всё).
# Адрес туннеля новый при каждом запуске: после перезапуска разошлите участникам новую ссылку.
set -euo pipefail

BOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$BOT_DIR/../nutrivia-app"
API_PORT=8001
LOGS="$BOT_DIR/data/pilot-logs"
mkdir -p "$LOGS"

pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

tunnel() {  # $1 порт, $2 имя лога → печатает https-адрес туннеля
  cloudflared tunnel --no-autoupdate --url "http://localhost:$1" >"$LOGS/$2.log" 2>&1 &
  pids+=($!)
  for _ in $(seq 60); do
    url=$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOGS/$2.log" | head -1 || true)
    [ -n "$url" ] && { echo "$url"; return; }
    sleep 1
  done
  echo "туннель $2 не поднялся, см. $LOGS/$2.log" >&2; exit 1
}

# Свежая веб-версия приложения; API раздаёт её с того же адреса
(cd "$APP_DIR" && npx expo export -p web --output-dir dist >"$LOGS/web-build.log" 2>&1) \
  || { echo "веб-версия не собралась, см. $LOGS/web-build.log"; exit 1; }

# Мак не засыпает, пока пилот запущен
caffeinate -ims -w $$ &

cd "$BOT_DIR"
WEB_DIR="$APP_DIR/dist" PORT=$API_PORT .venv/bin/python -m nutrivia.api >"$LOGS/api.log" 2>&1 &
pids+=($!)
for _ in $(seq 30); do curl -sf "http://localhost:$API_PORT/health" >/dev/null && break; sleep 1; done
curl -sf "http://localhost:$API_PORT/health" >/dev/null || { echo "API не запустился, см. $LOGS/api.log"; exit 1; }

URL=$(tunnel $API_PORT api-tunnel)
echo "$URL" >"$LOGS/link.txt"
cat <<MSG

Пилот запущен.
  Приложение: $URL   (открыть в Safari / Chrome на телефоне)
  Логи:       $LOGS
  Коды входа: .venv/bin/python -m scripts.pilot_code +7707…

Мак не выключать и не усыплять. Остановить — Ctrl+C.
MSG
wait

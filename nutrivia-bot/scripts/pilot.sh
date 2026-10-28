#!/usr/bin/env bash
# Пилот с Мака: API + приложение для Expo Go, наружу через бесплатные туннели Cloudflare.
# Настройки и ключи — в nutrivia-bot/.env. Остановить — Ctrl+C (гасит всё).
# Адреса туннелей новые при каждом запуске: после перезапуска разошлите участникам новую ссылку.
set -euo pipefail

BOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$BOT_DIR/../nutrivia-app"
API_PORT=8001
METRO_PORT=8082
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

# Мак не засыпает, пока пилот запущен
caffeinate -ims -w $$ &

cd "$BOT_DIR"
PORT=$API_PORT .venv/bin/python -m nutrivia.api >"$LOGS/api.log" 2>&1 &
pids+=($!)
for _ in $(seq 30); do curl -sf "http://localhost:$API_PORT/health" >/dev/null && break; sleep 1; done
curl -sf "http://localhost:$API_PORT/health" >/dev/null || { echo "API не запустился, см. $LOGS/api.log"; exit 1; }

API_URL=$(tunnel $API_PORT api-tunnel)
METRO_URL=$(tunnel $METRO_PORT metro-tunnel)

cd "$APP_DIR"
EXPO_PUBLIC_API_URL="$API_URL" EXPO_PACKAGER_PROXY_URL="$METRO_URL" \
  npx expo start --port $METRO_PORT --no-dev --minify >"$LOGS/metro.log" 2>&1 &
pids+=($!)

LINK="exps://${METRO_URL#https://}"
echo "$LINK" >"$LOGS/link.txt"
cat <<EOF

Пилот запущен.
  API:        $API_URL
  Приложение: $LINK
  (в Expo Go: «Enter URL manually» → вставить ссылку)
  Логи:       $LOGS  (коды из SMS при SMS_PROVIDER=console — в api.log)

Мак не выключать и не усыплять. Остановить — Ctrl+C.
EOF
wait

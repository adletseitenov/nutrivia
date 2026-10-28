"""Выдать участнику пилота код входа (SMS_PROVIDER=manual) и готовое сообщение для WhatsApp.

    .venv/bin/python -m scripts.pilot_code +77071234567 [+77017654321 ...]

Код одноразовый, живёт 7 дней; повторный запуск для того же номера выдаёт новый код взамен старого.
Берёт DB_PATH и AUTH_SECRET из .env — те же, что у запущенного сервера.
"""
import asyncio
import os
import sys
from pathlib import Path

from nutrivia.auth import AuthError, ManualCodes, SmsAuth
from nutrivia.config import ROOT, load_config
from nutrivia.db import Database

LINK = ROOT / "data" / "pilot-logs" / "link.txt"


async def main(phones: list[str]) -> None:
    cfg = load_config()
    secret = os.environ.get("AUTH_SECRET")
    if not secret:
        sys.exit("нет AUTH_SECRET в .env — коды не совпадут с сервером")
    db = Database(cfg.db_path)
    await db.connect()
    auth = SmsAuth(db, ManualCodes(), secret)
    await auth.init()
    link = LINK.read_text().strip() if LINK.exists() else "<ссылка из scripts/pilot.sh>"
    try:
        for raw in phones:
            try:
                phone, code = await auth.issue_manual(raw)
            except AuthError as e:
                print(f"{raw}: {e.message}\n")
                continue
            print(f"--- {phone} ---")
            print(f"""Привет! Это Nutrivia — фото еды → калории и разбор от нутрициолога.
1. Поставь Expo Go из App Store / Google Play.
2. Открой в нём «Enter URL manually» и вставь: {link}
3. Введи свой номер и код входа: {code}
Код одноразовый, действует 7 дней.
""")
    finally:
        await db.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    asyncio.run(main(sys.argv[1:]))

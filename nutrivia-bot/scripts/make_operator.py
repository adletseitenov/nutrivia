"""Сделать номер оператором Nutrivia: в приложении у него кабинет с разборами клиентов без тренера
и просроченными (дольше 15 минут) разборами учеников тренеров.

    .venv/bin/python -m scripts.make_operator +77071234567

Номер уже зарегистрирован — меняется роль. Нет — создаётся аккаунт оператора; войти по коду
из scripts.pilot_code (или SMS). Берёт DB_PATH и AUTH_SECRET из .env — те же, что у сервера.
"""
import asyncio
import os
import sys

from nutrivia.auth import ManualCodes, SmsAuth, normalize_phone
from nutrivia.config import load_config
from nutrivia.db import Database
from nutrivia.engine import DishBase
from nutrivia.service import Service
from nutrivia.vision import FakeVision


async def main(raw: str) -> None:
    cfg = load_config()
    db = Database(cfg.db_path)
    await db.connect()
    auth = SmsAuth(db, ManualCodes(), os.environ.get("AUTH_SECRET", ""))
    await auth.init()
    try:
        phone = normalize_phone(raw)
        uid = await auth.user_for_phone(phone)
        if uid is None:
            svc = Service(db, DishBase.from_csv(cfg.dishes_csv), FakeVision(), cfg)
            uid = (await svc.create_app_user("client", "ru", None, None))["tg_id"]
            await auth.link(phone, uid)
        user = await db.get_user(uid)
        if user["coach_code"] or await db.fetchone("SELECT 1 FROM pros WHERE user_id = ?", (uid,)):
            sys.exit(f"{phone}: у номера уже есть тренер или кабинет специалиста — оператором не делаю")
        await db.update_user(uid, role="operator")
        await db.log_event("operator_set", uid)
        print(f"{phone}: оператор. Войти в приложение по коду: .venv/bin/python -m scripts.pilot_code {phone}")
    finally:
        await db.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    asyncio.run(main(sys.argv[1]))

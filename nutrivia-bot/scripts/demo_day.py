"""Демо-день для показа: у ученика три приёма пищи сегодня — два проверены тренером, ужин ждёт.

Работает против запущенного API (fake vision) и его базы:
    .venv/bin/python -m scripts.demo_day
"""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

import httpx

from nutrivia.auth import ConsoleSms, SmsAuth
from nutrivia.db import Database

API = os.environ.get("API", "http://127.0.0.1:8000")
DB_PATH = os.environ.get("DB_PATH", "data/api-demo.db")
SECRET = os.environ.get("AUTH_SECRET", "dev-secret-change-me")
PHOTO = os.environ.get("PHOTO", "../nutrivia-app/assets/images/demo-plov.png")
ALMATY = timezone(timedelta(hours=5))

STUDENT, TRAINER = "+77015550001", "+77071117071"

# (час, минута, блюда после проверки, комментарий тренера или None — ждёт проверки)
MEALS = [
    (8, 40, [("oatmeal", 250), ("banana", 120), ("tea_milk", 250)], "Отличный завтрак. Банан можно оставить на перекус после тренировки."),
    (13, 15, [("plov", 250), ("salad_veg", 150)], "Плов в норме, салат — молодец. Вечером добавьте белка: курица или рыба."),
    (17, 45, [("chicken_breast", 150), ("buckwheat", 150), ("salad_veg", 120)], None),
]


async def tokens() -> tuple[str, str]:
    db = Database(DB_PATH)
    await db.connect()
    auth = SmsAuth(db, ConsoleSms(), SECRET)
    out = []
    for phone in (STUDENT, TRAINER):
        uid = await auth.user_for_phone(phone)
        if uid is None:
            sys.exit(f"нет аккаунта {phone} в {DB_PATH}")
        out.append(await auth.issue(uid))
    await db.conn.commit()
    await db.conn.close()
    return out[0], out[1]


async def main() -> None:
    student, trainer = await tokens()
    today = datetime.now(ALMATY).date()
    photo = open(PHOTO, "rb").read()
    ids = []
    async with httpx.AsyncClient(base_url=API, timeout=30) as c:
        s = {"Authorization": f"Bearer {student}"}
        t = {"Authorization": f"Bearer {trainer}"}
        for hour, minute, items, comment in MEALS:
            r = await c.post("/v1/meals", headers=s, files={"photo": ("meal.png", photo, "image/png")})
            r.raise_for_status()
            mid = r.json()["id"]
            ids.append((mid, hour, minute))
            if comment is None:
                continue
            body = {"items": [{"dish_id": d, "grams": g} for d, g in items]}
            (await c.put(f"/v1/pro/meals/{mid}/items", headers=t, json=body)).raise_for_status()
            (await c.post(f"/v1/pro/meals/{mid}/comment", headers=t, json={"text": comment})).raise_for_status()
            (await c.post(f"/v1/pro/meals/{mid}/send", headers=t)).raise_for_status()
        # Ужин ученик уточнил сам — тренер ещё не смотрел
        last = ids[-1][0]
        body = {"items": [{"dish_id": d, "grams": g} for d, g in MEALS[-1][2]]}
        (await c.put(f"/v1/meals/{last}/items", headers=s, json=body)).raise_for_status()

    # Время приёмов — как будто фото присланы утром, днём и вечером
    db = Database(DB_PATH)
    await db.connect()
    for mid, hour, minute in ids:
        ts = int(datetime(today.year, today.month, today.day, hour, minute, tzinfo=ALMATY).timestamp())
        await db.execute("UPDATE meals SET received_at = ?, draft_at = ?, "
                         "reviewed_at = CASE WHEN reviewed_at IS NULL THEN NULL ELSE ? END, "
                         "sent_at = CASE WHEN sent_at IS NULL THEN NULL ELSE ? END WHERE id = ?",
                         (ts, ts + 20, ts + 9 * 60, ts + 9 * 60, mid))
    await db.conn.commit()
    await db.conn.close()
    print("meals:", [m for m, _, _ in ids])


if __name__ == "__main__":
    asyncio.run(main())

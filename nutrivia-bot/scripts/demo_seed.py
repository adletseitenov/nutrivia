"""Демо-аккаунты для показа: клиент с заполненной неделей, тренер с учениками, оператор.

Пишет прямо в базу (DB_PATH из .env или окружения), сервер можно не останавливать. ИИ не вызывает:
фото «разбирает» офлайн-провайдер, блюда и граммы проставляет тренер, как в жизни.

    .venv/bin/python -m scripts.demo_seed            # создать (если номера свободны)
    .venv/bin/python -m scripts.demo_seed --reset    # удалить эти аккаунты со всеми данными и создать заново

Войти: код выдаёт админка (/admin → «Код входа участнику») или scripts/pilot_code.py.
"""
import asyncio
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

from nutrivia.auth import ConsoleSms, SmsAuth, normalize_phone
from nutrivia.config import ALMATY, load_config
from nutrivia.db import Database
from nutrivia.engine import DishBase
from nutrivia.service import Service
from nutrivia.vision import FakeVision

CLIENT = os.environ.get("DEMO_CLIENT", "+77000000001")   # настоящий номер — только в переменной DEMO_CLIENT, не в коде
TRAINER = os.environ.get("DEMO_TRAINER", "+77000000002")
OPERATOR = os.environ.get("DEMO_OPERATOR", "+77000000003")
STUDENTS = ["+77000000011", "+77000000012"]
PHOTO = Path(os.environ.get("DEMO_PHOTO") or Path(__file__).resolve().parents[2] / "nutrivia-app/assets/images/demo-plov.png")

# Неделя клиента: (час, минута, блюда после проверки, комментарий тренера)
DAYS = [
    [(8, 30, [("oatmeal", 250), ("banana", 120), ("tea_milk", 250)], "Хороший завтрак, банан — отличный перекус."),
     (13, 20, [("plov", 300), ("salad_veg", 150)], "Плов в норме, салат — молодец."),
     (19, 40, [("chicken_breast", 150), ("buckwheat", 150), ("salad_veg", 100)], "Ужин идеальный по белку.")],
    [(9, 0, [("omelet", 150), ("bread_rye", 40), ("coffee_milk", 250)], "Омлет — отличный старт."),
     (13, 45, [("lagman", 400)], "Лагман сытный — вечером полегче."),
     (20, 0, [("fish_baked", 150), ("salad_cabbage", 150)], "Рыба — супер, так держать.")],
    [(8, 15, [("cottage_cheese", 180), ("strawberry", 100)], "Творог — много белка, отлично."),
     (14, 0, [("sorpa", 350), ("lepeshka", 60)], "Сорпа хороша, лепёшки можно половину."),
     (19, 30, [("manty", 200), ("kefir", 250)], "Манты на ужин — норм, кефир кстати.")],
    [(8, 40, [("oatmeal_milk", 250), ("apple", 150)], "Каша с яблоком — классика."),
     (13, 10, [("beef_stew", 200), ("rice_boiled", 150), ("salad_veg", 100)], "Хорошая тарелка: белок, гарнир, овощи."),
     (19, 50, [("turkey", 150), ("potato_boiled", 200)], "Индейка — лёгкий белок, отлично.")],
    [(9, 10, [("syrniki", 180), ("tea_black", 250)], "Сырники — ок, без сахара в чае — плюс."),
     (13, 30, [("chicken_soup", 350), ("bread_rye", 40)], "Суп в обед — хорошая привычка."),
     (20, 10, [("shashlyk", 200), ("salad_veg", 150)], "Шашлык с овощами — правильный выбор.")],
    [(10, 0, [("egg_boiled", 120), ("bread_rye", 40), ("avocado", 70)], "Яйца с авокадо — отличный завтрак."),
     (14, 20, [("beshbarmak", 350)], "Бешбармак в выходной — нормально, вечером легче."),
     (19, 0, [("kefir", 250), ("salad_cabbage", 150)], "Лёгкий ужин после бешбармака — умно.")],
    # сегодня — завтрак и обед; вечер оставляем пустым, чтобы был «Совет на вечер»
    [(8, 35, [("oatmeal", 250), ("banana", 120), ("tea_milk", 250)], "Отличный старт дня."),
     (13, 15, [("plov", 250), ("salad_veg", 150)], "Плов в норме. Вечером добавьте белка: курица или рыба.")],
]
WEIGHTS = [82.6, 82.4, 82.5, 82.1, 81.9, 81.8, 81.6]
WEEK_COMMENT = ("Неделя ровная: 3 приёма в день, белка почти каждый день по ориентиру. "
                "На следующей — меньше хлеба к супу и чуть больше овощей на ужин.")


def at(day: datetime, hour: int, minute: int) -> int:
    return int(day.replace(hour=hour, minute=minute, second=0, microsecond=0).timestamp())


async def main(reset: bool) -> None:
    cfg = load_config()
    db = Database(cfg.db_path)
    await db.connect()
    svc = Service(db, DishBase.from_csv(cfg.dishes_csv), FakeVision(), cfg)
    auth = SmsAuth(db, ConsoleSms(), os.environ.get("AUTH_SECRET", "seed"))
    await auth.init()
    real_clock = db.clock
    photo = PHOTO.read_bytes()
    phones = [CLIENT, TRAINER, OPERATOR, *STUDENTS]

    for raw in phones:
        uid = await auth.user_for_phone(normalize_phone(raw))
        if uid is None:
            continue
        if not reset:
            # базу закрываем обязательно: открытое соединение aiosqlite не даёт процессу завершиться,
            # и в Docker сервер после этого скрипта так и не стартует
            print(f"{raw} уже есть в {cfg.db_path} — демо-аккаунты не трогаю (пересоздать: --reset).")
            await db.conn.close()
            return
        # как «Удалить аккаунт» в приложении: сначала входы — иначе новый аккаунт с тем же id унаследует чужую сессию
        await auth.forget_user(uid)
        await svc.delete_user(uid)
        await db.execute("DELETE FROM pros WHERE user_id = ?", (uid,))

    # DEMO_NOW=2026-11-05T17:10 — собрать демо «как будто сейчас» это время (скрины, футаж); по умолчанию — сейчас
    now = datetime.fromisoformat(os.environ["DEMO_NOW"]).replace(tzinfo=ALMATY) if os.environ.get("DEMO_NOW") \
        else datetime.now(ALMATY)
    first = (now - timedelta(days=len(DAYS) - 1)).replace(hour=7, minute=0, second=0, microsecond=0)

    async def account(raw: str, role: str, name: str | None, ts: int, **profile) -> int:
        db.clock = lambda: ts
        user = await svc.create_app_user(role, "ru", profile.pop("goal", None), name)
        await auth.link(normalize_phone(raw), user["tg_id"])
        if profile:
            await db.update_user(user["tg_id"], **profile)
        return user["tg_id"]

    start = int(first.timestamp())
    trainer = await account(TRAINER, "trainer", "Айбек · тренер", start)
    code = await svc.pro_code(trainer)
    client = await account(CLIENT, "client", None, start, goal="lose", sex="m", birth_year=1996,
                           height_cm=178, weight_kg=WEIGHTS[0], activity="mid")
    await svc.join_coach(client, code)

    async def reviewed_meal(user: int, ts: int, items, comment: str | None) -> int:
        db.clock = lambda: ts
        out = await svc.receive_photo(user, photo, "image/png", ts=ts)
        db.clock = lambda: ts + 9 * 60
        await svc.pro_set_items(trainer, out.meal_id, items)
        if comment:
            await svc.pro_comment(trainer, out.meal_id, comment)
        await svc.pro_send(trainer, out.meal_id)
        if not any(d == "plov" for d, _ in items):  # фото у нас одно — плов; к остальным приёмам фото не показываем
            await db.execute("UPDATE meals SET photo_path = NULL WHERE id = ?", (out.meal_id,))
        return out.meal_id

    last_meal = None
    for i, meals in enumerate(DAYS):
        day = first + timedelta(days=i)
        for hour, minute, items, comment in meals:
            ts = at(day, hour, minute)
            if ts > int(now.timestamp()):
                continue
            last_meal = await reviewed_meal(client, ts, items, comment)
        db.clock = lambda: at(day, 7, 30)
        await svc.add_weight(client, WEIGHTS[i], ts=at(day, 7, 30))

    # Ещё двое учеников у тренера: один разбор ждёт проверки — очередь тренера не пустая
    others = []
    for n, raw in enumerate(STUDENTS):
        sid = await account(raw, "client", None, start + 3 * 86400, goal="even" if n else "muscle")
        await svc.join_coach(sid, code)
        others.append(sid)
        for d in (2, 1):
            day = now - timedelta(days=d)
            await reviewed_meal(sid, at(day, 9, 0), [("omelet", 150), ("bread_white", 40)], None)
            await reviewed_meal(sid, at(day, 14, 0), [("lagman", 350)], None)
    db.clock = lambda: int(now.timestamp()) - 25 * 60
    await svc.receive_photo(others[0], photo, "image/png", ts=int(now.timestamp()) - 25 * 60)

    db.clock = real_clock if not os.environ.get("DEMO_NOW") else (lambda: int(now.timestamp()))
    await svc.set_week_comment(trainer, client, WEEK_COMMENT)

    # Лента: пост клиента с приёмом пищи и рецепт другого ученика, взаимные лайки
    _, mine = await svc.add_post(client, "habit", "Пью кефир вместо перекуса вечером — к утру лёгкость, и сплю лучше.", None)
    _, recipe = await svc.add_post(others[1], "recipe",
                                   "Плов на курице: меньше масла, больше моркови. Вкус тот же, а после обеда не клонит в сон.",
                                   None)
    _, lunch = await svc.add_post(client, "habit", "Обед по тарелке: половина — овощи, четверть — белок.", last_meal)
    for pid, who in ((mine["id"], others[0]), (mine["id"], others[1]), (recipe["id"], client), (lunch["id"], others[0])):
        await svc.toggle_like(who, pid)

    _, status = await svc.make_operator(auth, OPERATOR)
    await db.conn.commit()
    streak = await svc.streak_view(client, int(now.timestamp()))
    print(f"База: {cfg.db_path}")
    print(f"Клиент   {CLIENT} — серия {streak['days']} дн., стадия {streak['stage']}, тренер с кодом {code}")
    print(f"Тренер   {TRAINER} — учеников {1 + len(others)}, один разбор ждёт проверки")
    print(f"Оператор {OPERATOR} — {status}")
    print("Коды входа: /admin → «Код входа участнику» или scripts/pilot_code.py")
    await db.conn.close()


if __name__ == "__main__":
    asyncio.run(main("--reset" in sys.argv))

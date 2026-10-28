"""Офлайн-прогон без Telegram и без API: 2 недели, 12 участников, имитация проверяющих.
    python -m scripts.offline_run                 # симуляция, метрики в exports/offline
    python -m scripts.offline_run --photo a.jpg   # один реальный вызов claude-opus-5-5 (нужен ANTHROPIC_API_KEY)
"""
import argparse
import asyncio
import random
import tempfile
from datetime import datetime

from nutrivia.config import ALMATY, ROOT, Config, load_config
from nutrivia.db import Database
from nutrivia.drafts import build_items, format_client
from nutrivia.engine import DishBase
from nutrivia.matcher import Matcher
from nutrivia.metrics import compute_metrics, export_csv
from nutrivia.service import Service
from nutrivia.vision import FakeVision, make_vision

MENU = [("плов", "пиала", 300), ("манты", "штука", 240), ("бешбармак", "тарелка", 350),
        ("лагман", "пиала", 400), ("салат", "тарелка", 150), ("баурсаки", "штука", 75),
        ("чай с молоком", "кесе", 200), ("курица", "кусок", 150), ("гречка", "порция", 150),
        ("омлет", "порция", 150), ("лепешка", "четверть", 60), ("суши", "штука", 180),
        ("шаурма", "штука", 300), ("творог", "пачка", 200)]


class RandomVision(FakeVision):
    def __init__(self, rng):
        super().__init__()
        self.rng = rng

    async def analyze(self, image, media_type="image/jpeg"):
        picks = self.rng.sample(MENU, self.rng.randint(1, 3))
        self.payload = {"is_food": self.rng.random() > 0.03, "dishes": [
            {"name": n, "portion": 1, "unit": u, "grams": round(g * self.rng.uniform(0.7, 1.3)),
             "confidence": round(self.rng.uniform(0.5, 0.95), 2)} for n, u, g in picks]}
        return await super().analyze(image)


async def simulate(seed: int = 7) -> None:
    rng = random.Random(seed)
    tmp = tempfile.mkdtemp()
    db = Database(":memory:")
    await db.connect()
    cfg = Config(solo_review_chat_id=-100, photos_dir=tmp)
    svc = Service(db, DishBase.from_csv(cfg.dishes_csv), RandomVision(rng), cfg)
    await db.execute("INSERT INTO coaches VALUES ('aigul', 'Айгуль', -200)")

    start = int(datetime(2026, 11, 3, 8, 0, tzinfo=ALMATY).timestamp())
    clock = [start]
    db.clock = lambda: clock[0]
    users = []
    for uid in range(1, 13):
        await svc.register(uid, "kk" if uid % 4 == 0 else "ru", "c_aigul" if uid <= 5 else "solo")
        if uid == 12:
            continue  # не дал согласие
        await svc.consent(uid)
        await svc.set_goal(uid, rng.choice(["lose", "muscle", "even", "coach_plan"]))
        await svc.set_restrictions(uid, None)
        users.append((uid, rng.uniform(0.35, 0.95)))  # склонность продолжать

    sent_counts = {"advice": 0, "weekly": 0, "offers": 0}
    for day in range(14):
        for uid, stick in users:
            if rng.random() > stick * (1 - day * 0.03):
                continue
            for hour in rng.sample([9, 13, 16, 20], rng.randint(1, 3)):
                ts = start + day * 86400 + (hour - 8) * 3600 + rng.randint(0, 1800)
                clock[0] = ts
                out = await svc.receive_photo(uid, b"\xff\xd8fake", ts=ts)
                if out.status != "draft":
                    continue
                if rng.random() < 0.4:  # проверяющий правит граммы
                    items = await db.meal_items(out.meal_id)
                    it = rng.choice(items)
                    await svc.reviewer_edit(out.meal_id, f"{it['raw_name']} {round(it['grams'] * rng.uniform(0.8, 1.25))}")
                clock[0] = ts + rng.randint(40, 600)  # проверяющий открыл карточку через 1–10 минут
                res = await svc.reviewer_send(out.meal_id, reviewer_id=900)
                if res and rng.random() < 0.8:
                    await svc.client_confirm(uid, out.meal_id)
                elif res:
                    await svc.start_correction(uid, out.meal_id)
                    await svc.client_correction(uid, out.meal_id, rng.choice(["плов 200", "было меньше"]))
        evening = start + day * 86400 + 11 * 3600
        clock[0] = evening
        for uid, _ in await svc.due_advice(evening):
            sent_counts["advice"] += 1
            if rng.random() < 0.3:
                await db.log_event("advice_done", uid)
        if datetime.fromtimestamp(evening, ALMATY).weekday() == 6:
            sent_counts["weekly"] += len(await svc.due_weekly(evening + 3600))
    # день 15: оффер «одиночкам», двое платят
    clock[0] = start + 14 * 86400 + 4 * 3600
    offered = await svc.due_offers(clock[0])
    sent_counts["offers"] += len(offered)
    for u in offered[:2]:
        await svc.mark_paid(u["tg_id"], cfg.offer_price_kzt, by=900)

    m = await compute_metrics(db)
    for k, v in m["summary"].items():
        print(f"{k:32} {v}")
    print("\nнет в базе:", m["missing_dishes"])
    print("рассылки:", sent_counts)
    sample_user = await db.get_user(users[0][0])
    print("\n--- пример недельного итога ---\n" + await svc.weekly_for(sample_user, start + 13 * 86400 + 12 * 3600))
    print("\n--- пример совета ---\n" + await svc.advice_for(sample_user, start + 13 * 86400 + 11 * 3600))
    out = await export_csv(db, str(ROOT / "exports" / "offline"))
    print(f"\nCSV: {out}")
    await db.close()


async def real_photo(path: str) -> None:
    cfg = load_config()
    base = DishBase.from_csv(cfg.dishes_csv)
    media = "image/png" if path.lower().endswith(".png") else "image/jpeg"
    vision = make_vision(cfg.vision_provider, cfg.vision_model, cfg.openrouter_api_key)
    r = await vision.analyze(open(path, "rb").read(), media)
    print(f"status={r.status} model={r.model} latency={r.latency_ms}ms cost=${r.cost_usd:.4f} {r.error}")
    for d in r.dishes:
        print(f"  {d.name}: {d.portion} {d.unit}, {d.grams} г, увер. {d.confidence}")
    if r.dishes:
        print("\n" + format_client(build_items(r.dishes, base, Matcher(base)), base))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--photo")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    asyncio.run(real_photo(args.photo) if args.photo else simulate(args.seed))

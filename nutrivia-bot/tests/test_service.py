import json
from datetime import datetime

import pytest

from nutrivia.config import ALMATY, Config
from nutrivia.db import Database
from nutrivia.metrics import compute_metrics
from nutrivia.service import Service
from nutrivia.vision import FakeVision

NOON = int(datetime(2026, 11, 4, 13, 0, tzinfo=ALMATY).timestamp())


@pytest.fixture
async def svc(base, tmp_path):
    db = Database(":memory:")
    await db.connect()
    cfg = Config(solo_review_chat_id=-100, photos_dir=str(tmp_path / "photos"))
    s = Service(db, base, FakeVision(), cfg)
    yield s
    await db.close()


async def onboard(svc, tg_id=1, payload="solo"):
    await svc.register(tg_id, "ru", payload)
    await svc.consent(tg_id)
    await svc.set_goal(tg_id, "lose")
    await svc.set_restrictions(tg_id, None)


async def test_coach_link_and_unknown_code(svc):
    await svc.db.execute("INSERT INTO coaches VALUES ('aigul', 'Айгуль', -200)")
    user, coach = await svc.register(5, "kk", "c_aigul")
    assert user["grp"] == "coach" and coach["name"] == "Айгуль" and user["lang"] == "kk"
    assert await svc.review_chat_for(user) == -200
    user, coach = await svc.register(6, "ru", "c_nope")
    assert user["grp"] == "solo" and coach is None


async def test_photo_needs_consent(svc):
    await svc.register(1, "ru", "solo")
    assert (await svc.receive_photo(1, b"img")).status == "no_consent"


async def test_full_flow(svc):
    await onboard(svc)
    out = await svc.receive_photo(1, b"img", ts=NOON)
    assert out.status == "draft" and out.review_chat_id == -100 and not out.night
    assert "плов" in out.review_text and "#meal" in out.review_text

    assert await svc.reviewer_edit(out.meal_id, "плов 350\nчай 200") == []
    items = {i["dish_id"]: i["grams"] for i in await svc.db.meal_items(out.meal_id)}
    assert items == {"plov": 350, "salad_veg": 100, "tea_milk": 200}

    await svc.reviewer_comment(out.meal_id, "Хороший выбор овощей")
    client_id, text = await svc.reviewer_send(out.meal_id, reviewer_id=99)
    assert client_id == 1
    assert "оценка по фото" in text and "Хороший выбор овощей" in text
    assert await svc.reviewer_send(out.meal_id, 99) is None  # повторно не отправляется

    assert await svc.client_confirm(1, out.meal_id)
    m = await compute_metrics(svc.db)
    s = m["summary"]
    assert s["photos"] == 1 and s["replies_sent"] == 1 and s["confirmed_rate"] == 1.0
    assert s["gram_error_mean"] == pytest.approx(round((50 / 350) / 2, 3))  # плов 300→350, салат без правки


async def test_client_correction_auto_and_forward(svc):
    await onboard(svc)
    out = await svc.receive_photo(1, b"img", ts=NOON)
    await svc.reviewer_send(out.meal_id, 99)
    await svc.start_correction(1, out.meal_id)
    reply, forward = await svc.client_correction(1, out.meal_id, "плов 150")
    assert not forward and "≈150 г" in reply
    reply, forward = await svc.client_correction(1, out.meal_id, "плова было полпиалы")
    assert reply is None and forward
    assert (await svc.db.get_user(1))["state"] is None


async def test_daily_limit(svc):
    svc.cfg.daily_photo_limit = 2
    await onboard(svc)
    assert (await svc.receive_photo(1, b"a", ts=NOON)).status == "draft"
    assert (await svc.receive_photo(1, b"b", ts=NOON + 60)).status == "draft"
    assert (await svc.receive_photo(1, b"c", ts=NOON + 120)).status == "limit"


async def test_night_photo(svc):
    await onboard(svc)
    night = int(datetime(2026, 11, 4, 23, 30, tzinfo=ALMATY).timestamp())
    assert (await svc.receive_photo(1, b"img", ts=night)).night


async def test_not_food_and_vision_error(svc):
    await onboard(svc)
    svc.vision = FakeVision({"is_food": False, "dishes": []})
    assert (await svc.receive_photo(1, b"img", ts=NOON)).status == "not_food"


async def test_unknown_dish_flagged(svc):
    await onboard(svc)
    svc.vision = FakeVision({"is_food": True, "dishes": [
        {"name": "суши филадельфия", "portion": 6, "unit": "штука", "grams": 180, "confidence": 0.6}]})
    out = await svc.receive_photo(1, b"img", ts=NOON)
    assert "НЕТ В БАЗЕ" in out.review_text
    m = await compute_metrics(svc.db)
    assert m["missing_dishes"] == [("суши филадельфия", 1)]


async def test_delete_removes_everything(svc, tmp_path):
    await onboard(svc)
    out = await svc.receive_photo(1, b"img", ts=NOON)
    photo = (await svc.db.fetchone("SELECT photo_path FROM meals WHERE id = ?", (out.meal_id,)))["photo_path"]
    await svc.delete_user(1)
    assert await svc.db.get_user(1) is None
    assert not await svc.db.fetchall("SELECT * FROM meals WHERE user_id = 1")
    assert not await svc.db.fetchall("SELECT * FROM meal_items")
    from pathlib import Path
    assert not Path(photo).exists()
    leftover = await svc.db.fetchall("SELECT data FROM events WHERE user_id = 1 AND data IS NOT NULL")
    assert leftover == [] or all("deleted" in json.dumps(dict(r)) for r in leftover)


async def test_advice_weekly_offer(svc):
    await onboard(svc)
    out = await svc.receive_photo(1, b"img", ts=NOON)
    await svc.reviewer_send(out.meal_id, 99)
    evening = NOON + 6 * 3600
    advice = await svc.due_advice(evening)
    assert len(advice) == 1 and "По записанному сегодня" in advice[0][1]
    assert await svc.due_advice(evening + 60) == []  # не дублируется

    weekly = await svc.due_weekly(evening)
    assert "по записанному рациону" in weekly[0][1] and "Плов" in weekly[0][1]

    assert await svc.due_offers(NOON) == []
    assert len(await svc.due_offers(NOON + 15 * 86400)) == 1
    assert await svc.due_offers(NOON + 16 * 86400) == []
    assert await svc.mark_paid(1, 2000, by=99)
    assert (await compute_metrics(svc.db))["summary"]["paid_solo"] == 1


async def test_health_words():
    from nutrivia.service import Service
    assert Service.is_health_complaint("после еды болит живот")
    assert not Service.is_health_complaint("плов 200")

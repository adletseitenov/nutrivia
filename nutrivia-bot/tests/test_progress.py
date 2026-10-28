from datetime import datetime

import pytest

from nutrivia.config import ALMATY, Config
from nutrivia.db import Database
from nutrivia.service import Service
from nutrivia.vision import FakeVision

DAY0 = int(datetime(2026, 11, 3, 12, 0, tzinfo=ALMATY).timestamp())
DAY = 86400


@pytest.fixture
async def svc(base, tmp_path):
    db = Database(":memory:")
    await db.connect()
    db.clock = lambda: DAY0
    s = Service(db, base, FakeVision(), Config(solo_review_chat_id=-100, photos_dir=str(tmp_path)))
    user = await s.create_app_user("client", "ru", "lose", None)
    s.uid = user["tg_id"]
    yield s
    await db.close()


async def photos(svc, day, n):
    for k in range(n):
        out = await svc.receive_photo(svc.uid, b"\xff\xd8\xffx", ts=DAY0 + day * DAY + k * 3600)
        assert out.status == "draft"


async def test_stage_grows_with_streak(svc):
    for d in range(7):
        await photos(svc, d, 2)
    s = await svc.streak_view(svc.uid, DAY0 + 6 * DAY + 7200)
    assert s["days"] == 7 and s["stage"] == 3 and s["next_stage_in"] == 7 and s["today_counted"]


async def test_one_photo_does_not_count_but_today_does_not_break(svc):
    await photos(svc, 0, 2)
    await photos(svc, 1, 2)
    await photos(svc, 2, 1)  # сегодня пока одно фото
    s = await svc.streak_view(svc.uid, DAY0 + 2 * DAY + 3600)
    assert s["days"] == 2 and not s["today_counted"] and s["photos_today"] == 1


async def test_missed_day_drops_one_stage_not_to_zero(svc):
    for d in range(7):
        await photos(svc, d, 2)            # стадия 3
    # день 7 пропущен, день 8 — снова фото
    await photos(svc, 8, 2)
    s = await svc.streak_view(svc.uid, DAY0 + 8 * DAY + 7200)
    assert s["stage"] == 2 and s["days"] == 1 and s["best"] == 7
    assert s["next_stage_in"] == 6  # до стадии 3 нужно 7 дней подряд


async def test_week(svc):
    await photos(svc, 0, 2)
    await photos(svc, 2, 1)
    await svc.reviewer_comment(1, "Добавьте белок на ужин")
    await svc.reviewer_send(1, 99)
    w = await svc.week_view(svc.uid, DAY0 + 2 * DAY + 7200)
    assert len(w["days"]) == 7 and w["days"][-1]["date"] == "2026-11-05"
    assert w["logged_days"] == 2 and w["days"][-3]["meals"] == 2
    assert w["days"][-3]["kcal"] == 2 * 610  # плов 300 г + салат 100 г из FakeVision
    assert w["reviewed_photos"] == 1 and w["coach"]["comment"] == "Добавьте белок на ужин"
    assert w["targets"]["kcal"] == 1600

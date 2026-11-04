"""Уведомления в Telegram для пользователей приложения (nutrivia/notify.py)."""
from datetime import datetime

import pytest

from nutrivia.config import ALMATY, Config
from nutrivia.db import Database
from nutrivia.notify import LINK_TTL, chat_for, consume_link, due_reminders, new_link_token, review_done, unlink
from nutrivia.service import Service
from nutrivia.vision import FakeVision


def at(hour, minute=0, day=5):
    return int(datetime(2026, 11, day, hour, minute, tzinfo=ALMATY).timestamp())


@pytest.fixture
async def svc(base, tmp_path):
    db = Database(":memory:")
    await db.connect()
    s = Service(db, base, FakeVision(), Config(photos_dir=str(tmp_path / "p")))
    yield s
    await db.close()


async def client_and_trainer(svc):
    svc.db.clock = lambda: at(7, day=1)
    trainer = (await svc.create_app_user("trainer", "ru", None, "Айбек"))["tg_id"]
    client = (await svc.create_app_user("client", "ru", "lose", None))["tg_id"]
    assert await svc.join_coach(client, await svc.pro_code(trainer)) == "ok"
    return client, trainer


class Outbox:
    def __init__(self):
        self.sent = []

    async def __call__(self, chat_id, text, path):
        self.sent.append((chat_id, text, path))
        return True


async def test_link_is_one_time_and_expires(svc):
    client, _ = await client_and_trainer(svc)
    token = await new_link_token(svc.db, client)
    assert await consume_link(svc.db, "c_aigul", 500) is None          # обычный /start бота — не привязка
    assert await consume_link(svc.db, "app_" + token, 500) == client
    assert await chat_for(svc.db, client) == 500
    assert await consume_link(svc.db, "app_" + token, 600) is None     # второй раз — нет
    assert await chat_for(svc.db, client) == 500
    old = await new_link_token(svc.db, client)
    svc.db.clock = lambda: at(7, day=1) + LINK_TTL + 1
    assert await consume_link(svc.db, "app_" + old, 700) is None       # просрочен
    assert (await svc.me_view(client))["telegram"] == {"available": False, "linked": True}
    await unlink(svc.db, client)
    assert await chat_for(svc.db, client) is None


async def test_delete_account_forgets_telegram(svc):
    client, _ = await client_and_trainer(svc)
    await consume_link(svc.db, "app_" + await new_link_token(svc.db, client), 500)
    await svc.delete_user(client)
    assert await chat_for(svc.db, client) is None


async def test_review_done_message(svc):
    client, trainer = await client_and_trainer(svc)
    svc.db.clock = lambda: at(13)
    out = await svc.receive_photo(client, b"img", ts=at(13))
    await svc.pro_comment(trainer, out.meal_id, "Плов в норме, вечером больше белка.")
    box = Outbox()
    assert not await review_done(svc, out.meal_id, box)                # не привязан — молчим
    await consume_link(svc.db, "app_" + await new_link_token(svc.db, client), 500)
    assert await svc.pro_send(trainer, out.meal_id) == "ok"
    assert await review_done(svc, out.meal_id, box)
    chat, text, path = box.sent[0]
    assert chat == 500 and path == f"/meal?id={out.meal_id}"
    assert text.startswith("✅ Тренер проверил разбор: Плов") and "ккал" in text and "больше белка" in text
    assert "дефицит" not in text and "диагноз" not in text


async def test_reminders_once_a_day_and_only_when_needed(svc):
    client, _ = await client_and_trainer(svc)
    await consume_link(svc.db, "app_" + await new_link_token(svc.db, client), 500)
    svc.db.clock = lambda: at(11, 5)
    sent = await due_reminders(svc, at(11, 5))
    assert len(sent) == 1 and "Завтрак" in sent[0][1] and sent[0][2] == "/camera"
    assert await due_reminders(svc, at(11, 30)) == []                  # уже было сегодня
    assert await due_reminders(svc, at(14)) == []                      # не время

    svc.db.clock = lambda: at(13)
    await svc.receive_photo(client, b"img", ts=at(13))
    svc.db.clock = lambda: at(16, 1)
    (chat, text, path), = await due_reminders(svc, at(16, 1))
    assert chat == 500 and text.startswith("🌙 Совет на вечер") and "Например:" in text

    svc.db.clock = lambda: at(20, 1)
    (_, text, _), = await due_reminders(svc, at(20, 1))
    assert text.startswith("🫐 Ещё 1 фото") and "засчитается в серию" in text  # серии ещё нет
    # два фото — день засчитан, назавтра в 20:00 молчим, если снова два фото
    svc.db.clock = lambda: at(9, day=6)
    await svc.receive_photo(client, b"a", ts=at(9, day=6))
    await svc.receive_photo(client, b"b", ts=at(9, 5, day=6))
    svc.db.clock = lambda: at(20, 1, day=6)
    assert await due_reminders(svc, at(20, 1, day=6)) == []


async def test_reminders_skip_trainers(svc):
    _, trainer = await client_and_trainer(svc)
    await consume_link(svc.db, "app_" + await new_link_token(svc.db, trainer), 900)
    svc.db.clock = lambda: at(11, 5)
    assert await due_reminders(svc, at(11, 5)) == []

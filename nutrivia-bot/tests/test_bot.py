"""Смоук Telegram-слоя: апдейты прогоняются через Dispatcher, ответы Telegram подменены."""
from datetime import datetime

import pytest
from aiogram import Bot, Dispatcher
from aiogram.client.session.base import BaseSession
from aiogram.methods import (AnswerCallbackQuery, EditMessageCaption, EditMessageReplyMarkup, GetFile, GetMe,
                             SendMessage, SendPhoto)
from aiogram.types import CallbackQuery, Chat, File, Message, PhotoSize, Update, User

from nutrivia.bot import build
from nutrivia.config import Config
from nutrivia.db import Database
from nutrivia.service import Service
from nutrivia.vision import FakeVision

CLIENT = User(id=1, is_bot=False, first_name="Аружан", language_code="ru")
REVIEWER = User(id=99, is_bot=False, first_name="Оператор")
PM = Chat(id=1, type="private")
GROUP = Chat(id=-100, type="supergroup", title="Проверка")


class RecordingSession(BaseSession):
    def __init__(self):
        super().__init__()
        self.calls, self._msg_id = [], 1000

    async def make_request(self, bot, method, timeout=None):
        self.calls.append(method)
        if isinstance(method, (SendMessage, SendPhoto)):
            self._msg_id += 1
            chat = PM if method.chat_id == 1 else Chat(id=method.chat_id, type="supergroup")
            return Message(message_id=self._msg_id, date=datetime.now(), chat=chat,
                           text=getattr(method, "text", None), caption=getattr(method, "caption", None))
        if isinstance(method, GetFile):
            return File(file_id=method.file_id, file_unique_id="u", file_path="photos/x.jpg")
        if isinstance(method, GetMe):
            return User(id=7, is_bot=True, first_name="bot", username="nutrivia_test_bot")
        return True

    async def stream_content(self, url, headers=None, timeout=30, chunk_size=65536, raise_for_status=True):
        yield b"\xff\xd8fakejpeg"

    async def close(self):
        pass

    def sent(self, kind=SendMessage):
        return [c for c in self.calls if isinstance(c, kind)]


@pytest.fixture
async def env(base, tmp_path):
    db = Database(":memory:")
    await db.connect()
    cfg = Config(solo_review_chat_id=-100, photos_dir=str(tmp_path), admin_ids={99})
    svc = Service(db, base, FakeVision(), cfg)
    session = RecordingSession()
    bot = Bot("123456:TEST", session=session)
    dp = Dispatcher()
    dp.include_routers(*build(cfg, svc))
    counter = iter(range(1, 10_000))

    async def feed(**kw):
        await dp.feed_update(bot, Update(update_id=next(counter), **kw))

    def msg(chat, user, **kw):
        return Message(message_id=next(counter), date=datetime.now(), chat=chat, from_user=user, **kw)

    def cb(user, data, message):
        return CallbackQuery(id=str(next(counter)), from_user=user, chat_instance="ci", data=data, message=message)

    yield svc, session, feed, msg, cb
    await db.close()


async def test_end_to_end(env):
    svc, session, feed, msg, cb = env
    bot_msg = Message(message_id=1, date=datetime.now(), chat=PM, text="...")

    await feed(message=msg(PM, CLIENT, text="/start solo"))
    assert "согласие" in session.sent()[-1].text
    for data in ("consent", "goal:lose", "restr:no"):
        await feed(callback_query=cb(CLIENT, data, bot_msg))
    assert "Присылайте фото" in session.sent()[-1].text
    assert (await svc.db.get_user(1))["goal"] == "lose"

    await feed(message=msg(PM, CLIENT, photo=[PhotoSize(file_id="f", file_unique_id="fu", width=800, height=600)]))
    card = session.sent(SendPhoto)[-1]
    assert card.chat_id == -100 and "#meal1" in card.caption

    # проверяющий отвечает на карточку правкой граммов
    card_msg = Message(message_id=1001 + 5, date=datetime.now(), chat=GROUP, caption=card.caption)
    await svc.set_review_message(1, -100, card_msg.message_id)
    await feed(message=msg(GROUP, REVIEWER, text="плов 350", reply_to_message=card_msg))
    assert "350 г" in session.sent(EditMessageCaption)[-1].caption

    await feed(callback_query=cb(REVIEWER, "send:1", card_msg))
    reply = session.sent()[-1]
    assert reply.chat_id == 1 and "оценка по фото" in reply.text and "≈350 г" in reply.text

    await feed(callback_query=cb(CLIENT, "ok:1", bot_msg))
    assert (await svc.db.fetchone("SELECT status FROM meals WHERE id = 1"))["status"] == "confirmed"

    await feed(message=msg(PM, CLIENT, text="у меня болит живот"))
    assert "обратитесь к врачу" in session.sent()[-1].text

    await feed(message=msg(PM, CLIENT, text="/delete"))
    assert await svc.db.get_user(1) is None


async def test_add_coach_admin_only(env):
    svc, session, feed, msg, cb = env
    await feed(message=msg(GROUP, CLIENT, text="/add_coach aigul Айгуль"))
    assert await svc.db.get_coach("aigul") is None
    await feed(message=msg(GROUP, REVIEWER, text="/add_coach aigul Айгуль"))
    assert (await svc.db.get_coach("aigul"))["review_chat_id"] == -100
    assert "start=c_aigul" in session.sent()[-1].text

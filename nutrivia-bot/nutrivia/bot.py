"""Telegram-слой (aiogram 3): личка клиента, группы проверки, расписание."""
import asyncio
import logging
import re
import zlib
from datetime import datetime

from aiogram import Bot, Dispatcher, F, Router
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.types import (BufferedInputFile, CallbackQuery, ForceReply, InlineKeyboardButton,
                           InlineKeyboardMarkup, Message)

from .config import ALMATY, Config, load_config
from .db import Database
from .engine import DishBase
from .service import Service
from .texts import GOALS, HOME_PRODUCTS, lang_of, t
from .vision import make_vision

log = logging.getLogger(__name__)
MEAL_TAG = re.compile(r"#meal(\d+)")
CAPTION_LIMIT = 1024


def kb(*rows: list[tuple[str, str]]) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=text, callback_data=data) for text, data in row] for row in rows])


def review_kb(meal_id: int) -> InlineKeyboardMarkup:
    return kb([("✅ Отправить", f"send:{meal_id}")],
              [("✏️ Править граммы", f"edit:{meal_id}"), ("💬 Комментарий", f"comm:{meal_id}")])


def client_reply_kb(meal_id: int, lang: str) -> InlineKeyboardMarkup:
    return kb([(t("btn_ok", lang), f"ok:{meal_id}"), (t("btn_fix", lang), f"fix:{meal_id}")])


def advice_kb(lang: str) -> InlineKeyboardMarkup:
    return kb([(t("btn_done", lang), "adone"), (t("btn_home", lang), "home")])


def proxy_user_id(chat_id: int, label: str) -> int:
    """WhatsApp-клиент, чьи фото пересылает нутрициолог: устойчивый отрицательный id."""
    return -(zlib.crc32(f"{chat_id}:{label.lower()}".encode()) or 1)


async def send_review_card(bot: Bot, svc: Service, chat_id: int, meal_id: int, image: bytes, text: str) -> None:
    """Карточка черновика в группу проверки. Её же шлёт API для фото из приложения."""
    if not chat_id:
        log.error("no review chat for meal %s — задайте SOLO_REVIEW_CHAT_ID", meal_id)
        return
    caption = text if len(text) <= CAPTION_LIMIT else text[:CAPTION_LIMIT - 1] + "…"
    msg = await bot.send_photo(chat_id, BufferedInputFile(image, f"meal{meal_id}.jpg"),
                               caption=caption, reply_markup=review_kb(meal_id))
    await svc.set_review_message(meal_id, chat_id, msg.message_id)


def build(cfg: Config, svc: Service) -> tuple[Router, Router]:
    private = Router(name="private")
    private.message.filter(F.chat.type == "private")
    private.callback_query.filter(F.message.chat.type == "private")
    review = Router(name="review")
    review.message.filter(F.chat.type.in_({"group", "supergroup"}))
    review.callback_query.filter(F.message.chat.type.in_({"group", "supergroup"}))

    async def post_review(bot: Bot, chat_id: int, meal_id: int, image: bytes, text: str) -> None:
        await send_review_card(bot, svc, chat_id, meal_id, image, text)

    async def refresh_card(bot: Bot, meal) -> None:
        text = await svc.review_text(meal["id"])
        try:
            await bot.edit_message_caption(chat_id=meal["review_chat_id"], message_id=meal["review_msg_id"],
                                           caption=text[:CAPTION_LIMIT], reply_markup=review_kb(meal["id"]))
        except TelegramBadRequest as e:
            if "not modified" not in str(e):
                raise

    # ---------- личка клиента ----------
    @private.message(CommandStart())
    async def start(msg: Message, command: CommandObject):
        lang = lang_of(msg.from_user.language_code)
        user, coach = await svc.register(msg.from_user.id, lang, command.args)
        lang = user["lang"]
        if user["consent_at"]:
            await msg.answer(t("ready", lang))
            return
        note = t("coach_note", lang, name=coach["name"]) if coach else ""
        await msg.answer(t("welcome", lang, coach_note=note), reply_markup=kb([(t("btn_consent", lang), "consent")]))

    @private.callback_query(F.data == "consent")
    async def on_consent(cb: CallbackQuery):
        user = await svc.db.get_user(cb.from_user.id)
        if user is None:
            await cb.answer(t("need_start"))
            return
        await svc.consent(user["tg_id"])
        lang = user["lang"]
        await cb.message.edit_reply_markup(reply_markup=None)
        await cb.message.answer(t("ask_goal", lang), reply_markup=kb(
            *[[(t(f"goal_{g}", lang), f"goal:{g}")] for g in GOALS]))
        await cb.answer()

    @private.callback_query(F.data.startswith("goal:"))
    async def on_goal(cb: CallbackQuery):
        user = await svc.db.get_user(cb.from_user.id)
        await svc.set_goal(user["tg_id"], cb.data.split(":", 1)[1])
        await cb.message.edit_reply_markup(reply_markup=None)
        await cb.message.answer(t("ask_restrictions", user["lang"]),
                                reply_markup=kb([(t("btn_no", user["lang"]), "restr:no")]))
        await cb.answer()

    @private.callback_query(F.data == "restr:no")
    async def on_no_restrictions(cb: CallbackQuery):
        user = await svc.db.get_user(cb.from_user.id)
        await svc.set_restrictions(user["tg_id"], None)
        await cb.message.edit_reply_markup(reply_markup=None)
        await cb.message.answer(t("ready", user["lang"]))
        await cb.answer()

    @private.message(Command("delete"))
    async def delete(msg: Message):
        user = await svc.db.get_user(msg.from_user.id)
        lang = user["lang"] if user else lang_of(msg.from_user.language_code)
        await svc.delete_user(msg.from_user.id)
        await msg.answer(t("deleted", lang))

    @private.message(F.photo)
    async def photo(msg: Message, bot: Bot):
        user = await svc.db.get_user(msg.from_user.id)
        lang = user["lang"] if user else lang_of(msg.from_user.language_code)
        if user is None:
            await msg.answer(t("need_start", lang))
            return
        if not user["consent_at"]:
            await msg.answer(t("need_consent", lang))
            return
        if await svc.over_limit(user["tg_id"]):
            await msg.answer(t("photo_limit", lang, limit=cfg.daily_photo_limit))
            return
        image = (await bot.download(msg.photo[-1])).getvalue()
        hour = datetime.now(ALMATY).hour
        night = not (cfg.work_start_hour <= hour < cfg.work_end_hour)
        await msg.answer(t("photo_night" if night else "photo_ok", lang))
        out = await svc.receive_photo(user["tg_id"], image)
        if out.status == "limit":
            await msg.answer(t("photo_limit", lang, limit=cfg.daily_photo_limit))
        elif out.status == "not_food":
            await msg.answer(t("not_food", lang))
        elif out.status == "draft":
            await post_review(bot, out.review_chat_id, out.meal_id, image, out.review_text)

    @private.callback_query(F.data.startswith("ok:"))
    async def on_ok(cb: CallbackQuery):
        user = await svc.db.get_user(cb.from_user.id)
        if await svc.client_confirm(user["tg_id"], int(cb.data[3:])):
            await cb.message.edit_reply_markup(reply_markup=None)
            await cb.message.answer(t("thanks_ok", user["lang"]))
        await cb.answer()

    @private.callback_query(F.data.startswith("fix:"))
    async def on_fix(cb: CallbackQuery):
        user = await svc.db.get_user(cb.from_user.id)
        await svc.start_correction(user["tg_id"], int(cb.data[4:]))
        await cb.message.edit_reply_markup(reply_markup=None)
        await cb.message.answer(t("ask_fix", user["lang"]))
        await cb.answer()

    @private.callback_query(F.data == "adone")
    async def on_advice_done(cb: CallbackQuery):
        user = await svc.db.get_user(cb.from_user.id)
        await svc.db.log_event("advice_done", user["tg_id"])
        await cb.message.edit_reply_markup(reply_markup=None)
        await cb.answer(t("advice_done", user["lang"]))

    @private.callback_query(F.data == "home")
    async def on_home(cb: CallbackQuery):
        user = await svc.db.get_user(cb.from_user.id)
        lang = user["lang"]
        items = list(HOME_PRODUCTS.items())
        rows = [[(names[lang], f"home:{key}") for key, (names, _) in items[i:i + 2]] for i in range(0, len(items), 2)]
        await cb.message.answer(t("ask_home", lang), reply_markup=kb(*rows))
        await cb.answer()

    @private.callback_query(F.data.startswith("home:"))
    async def on_home_product(cb: CallbackQuery):
        user = await svc.db.get_user(cb.from_user.id)
        key = cb.data[5:]
        if key in HOME_PRODUCTS:
            await svc.db.log_event("advice_home", user["tg_id"], product=key)
            text = await svc.advice_for(user, home=key)
            await cb.message.answer(t("home_options", user["lang"]) + "\n" + text.split("\n", 1)[1],
                                    reply_markup=kb([(t("btn_done", user["lang"]), "adone")]))
        await cb.answer()

    @private.message(F.text)
    async def text(msg: Message, bot: Bot):
        user = await svc.db.get_user(msg.from_user.id)
        if user is None:
            await msg.answer(t("need_start", lang_of(msg.from_user.language_code)))
            return
        lang = user["lang"]
        if svc.is_health_complaint(msg.text):
            await svc.db.log_event("health_complaint", user["tg_id"])
            await msg.answer(t("doctor", lang))
            return
        state = user["state"] or ""
        if state == "restrictions":
            await svc.set_restrictions(user["tg_id"], msg.text[:500])
            await msg.answer(t("ready", lang))
        elif state.startswith("correction:"):
            meal_id = int(state.split(":")[1])
            reply, forward = await svc.client_correction(user["tg_id"], meal_id, msg.text)
            if reply:
                await msg.answer(t("fix_applied", lang) + "\n\n" + reply)
            if forward:
                await msg.answer(t("fix_forwarded", lang))
                await bot.send_message(await svc.review_chat_for(user),
                                       f"#meal{meal_id} · правка клиента {user['tg_id']}: «{msg.text}»\n"
                                       f"Ответьте на карточку разбора строками «плов 200» и нажмите «Отправить» снова "
                                       f"— или напишите клиенту комментарием.")
        elif user["offered_at"] and not user["paid_at"]:
            # ответ на оффер: «оплатил(а)» или номер для счёта — подтверждает человек через /paid
            await svc.db.log_event("payment_reply", user["tg_id"], text=msg.text[:200])
            await bot.send_message(await svc.review_chat_for(user),
                                   f"💰 Ответ на оффер от {user['tg_id']}: «{msg.text[:200]}». "
                                   f"Проверьте Kaspi и отметьте /paid {user['tg_id']} {cfg.offer_price_kzt}")
            await msg.answer(t("paid_thanks", lang))
        else:
            await msg.answer(t("send_photo_hint", lang))

    # ---------- группы проверки ----------
    def is_admin(user_id: int) -> bool:
        return user_id in cfg.admin_ids

    @review.message(Command("chat_id"))
    async def chat_id(msg: Message):
        await msg.reply(f"id этой группы: {msg.chat.id}")

    @review.message(Command("add_coach"))
    async def add_coach(msg: Message, command: CommandObject, bot: Bot):
        if not is_admin(msg.from_user.id):
            return
        parts = (command.args or "").split(maxsplit=1)
        if len(parts) < 2 or not re.fullmatch(r"[a-z0-9_]{2,32}", parts[0]):
            await msg.reply("Формат: /add_coach <код латиницей> <имя>")
            return
        await svc.db.execute("INSERT OR REPLACE INTO coaches (code, name, review_chat_id) VALUES (?, ?, ?)",
                             (parts[0], parts[1], msg.chat.id))
        me = await bot.me()
        await msg.reply(f"Нутрициолог {parts[1]} привязан к этой группе.\n"
                        f"Ссылка для клиентов: https://t.me/{me.username}?start=c_{parts[0]}")

    @review.message(Command("paid"))
    async def paid(msg: Message, command: CommandObject):
        if not is_admin(msg.from_user.id):
            return
        parts = (command.args or "").split()
        try:
            tg_id, amount = int(parts[0]), int(parts[1]) if len(parts) > 1 else cfg.offer_price_kzt
        except (IndexError, ValueError):
            await msg.reply("Формат: /paid <id клиента> [сумма]")
            return
        ok = await svc.mark_paid(tg_id, amount, msg.from_user.id)
        await msg.reply("Оплата отмечена." if ok else "Клиент не найден.")

    @review.message(Command("target"))
    async def target(msg: Message, command: CommandObject):
        meal = await meal_from_reply(msg)
        if meal is None or not (command.args or "").strip().isdigit():
            await msg.reply("Ответьте на карточку разбора: /target 1800")
            return
        await svc.db.update_user(meal["user_id"], kcal_target=int(command.args.strip()))
        await svc.db.log_event("target_set", meal["user_id"], kcal=int(command.args.strip()), by=msg.from_user.id)
        await msg.reply("Ориентир по калориям обновлён.")

    async def meal_from_reply(msg: Message):
        reply = msg.reply_to_message
        if reply is None:
            return None
        m = MEAL_TAG.search(reply.caption or reply.text or "")
        if m is None:
            return None
        meal = await svc.db.fetchone("SELECT * FROM meals WHERE id = ?", (int(m[1]),))
        return meal if meal and meal["review_chat_id"] == msg.chat.id else None

    @review.callback_query(F.data.startswith("send:"))
    async def on_send(cb: CallbackQuery, bot: Bot):
        meal_id = int(cb.data[5:])
        meal = await svc.db.fetchone("SELECT * FROM meals WHERE id = ?", (meal_id,))
        if meal is None or meal["review_chat_id"] != cb.message.chat.id:
            await cb.answer("Не найдено")
            return
        res = await svc.reviewer_send(meal_id, cb.from_user.id)
        if res is None:
            await cb.answer("Уже отправлено или пустой разбор", show_alert=True)
            return
        client_id, text = res
        user = await svc.db.get_user(client_id)
        if client_id < 0:  # WhatsApp-клиент: нутрициолог копирует текст сам
            await cb.message.reply(f"Скопируйте клиенту:\n\n{text}")
        elif user["channel"] == "app":  # приложение само заберёт статус «проверено»
            pass
        else:
            try:
                await bot.send_message(client_id, text, reply_markup=client_reply_kb(meal_id, user["lang"]))
            except TelegramForbiddenError:
                await svc.db.log_event("send_failed", client_id, meal_id=meal_id, reason="blocked")
                await cb.answer("Клиент заблокировал бота", show_alert=True)
                return
        await cb.message.edit_caption(caption=(cb.message.caption or "")[:CAPTION_LIMIT - 40] +
                                      f"\n\n✅ Отправлено · {cb.from_user.first_name}", reply_markup=None)
        await cb.answer("Отправлено")

    @review.callback_query(F.data.startswith(("edit:", "comm:")))
    async def on_edit_or_comment(cb: CallbackQuery):
        kind, meal_id = cb.data.split(":")
        prompt = ("правка: ответьте строками «плов 350» (0 — убрать блюдо)" if kind == "edit"
                  else "комментарий: ответьте текстом, он уйдёт клиенту вместе с разбором")
        await cb.message.reply(f"#meal{meal_id} {prompt}", reply_markup=ForceReply(selective=True))
        await cb.answer()

    @review.message(F.reply_to_message & F.text & ~F.text.startswith("/"))
    async def on_review_reply(msg: Message, bot: Bot):
        meal = await meal_from_reply(msg)
        if meal is None:
            return
        if meal["status"] != "draft":
            await msg.reply("Этот разбор уже отправлен.")
            return
        replied = msg.reply_to_message.text or ""
        if "комментарий:" in replied:
            await svc.reviewer_comment(meal["id"], msg.text)
        else:
            unknown = await svc.reviewer_edit(meal["id"], msg.text)
            if unknown:
                await msg.reply("Нет в базе: " + ", ".join(unknown) + ". Назовите иначе или добавьте в dishes.csv.")
        await refresh_card(bot, meal)

    @review.message(F.photo & F.caption.regexp(r"(?i)^wa\s+\S"))
    async def whatsapp_proxy(msg: Message, bot: Bot):
        """Запасной путь: нутрициолог шлёт в свою группу фото клиента из WhatsApp с подписью «wa Айгуль»."""
        coach = await svc.db.fetchone("SELECT * FROM coaches WHERE review_chat_id = ?", (msg.chat.id,))
        if coach is None:
            await msg.reply("Группа не привязана к нутрициологу: /add_coach")
            return
        label = msg.caption.split(maxsplit=1)[1].strip()
        uid = proxy_user_id(msg.chat.id, label)
        if await svc.db.get_user(uid) is None:
            await svc.db.execute(
                "INSERT INTO users (tg_id, lang, grp, coach_code, joined_at, consent_at, goal, restrictions)"
                " VALUES (?, 'ru', 'coach', ?, ?, ?, 'coach_plan', ?)",
                (uid, coach["code"], svc.db.clock(), svc.db.clock(), f"WhatsApp: {label}"))
            await svc.db.log_event("user_joined", uid, group="coach", coach_id=coach["code"], channel="whatsapp")
        image = (await bot.download(msg.photo[-1])).getvalue()
        out = await svc.receive_photo(uid, image)
        if out.status == "draft":
            await post_review(bot, msg.chat.id, out.meal_id, image, out.review_text)
        else:
            await msg.reply(f"Не получилось: {out.status}")

    return private, review


async def scheduler(bot: Bot, svc: Service, cfg: Config) -> None:
    """Раз в минуту: совет в 19:00, итог в воскресенье в 20:00, оффер в 12:00. Повторы отсекает jobs_done."""

    async def safe_send(chat_id: int, text: str, markup=None) -> None:
        try:
            await bot.send_message(chat_id, text, reply_markup=markup)
        except (TelegramForbiddenError, TelegramBadRequest) as e:
            await svc.db.log_event("send_failed", chat_id, reason=str(e)[:100])

    while True:
        try:
            local = datetime.now(ALMATY)
            if local.hour == cfg.advice_hour:
                for uid, text in await svc.due_advice():
                    user = await svc.db.get_user(uid)
                    await safe_send(uid, text, advice_kb(user["lang"]))
            if local.weekday() == 6 and local.hour == cfg.weekly_hour:
                for uid, text in await svc.due_weekly():
                    await safe_send(uid, text)
            if local.hour == 12:
                for user in await svc.due_offers():
                    key = "offer" if cfg.kaspi_pay_url else "offer_preorder"
                    await safe_send(user["tg_id"], t(key, user["lang"], price=cfg.offer_price_kzt,
                                                     url=cfg.kaspi_pay_url))
        except Exception:
            log.exception("scheduler tick failed")
        await asyncio.sleep(60)


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    cfg = load_config()
    if not cfg.bot_token:
        raise SystemExit("BOT_TOKEN не задан (.env)")
    db = Database(cfg.db_path)
    await db.connect()
    vision = make_vision(cfg.vision_provider, cfg.vision_model, cfg.openrouter_api_key)
    svc = Service(db, DishBase.from_csv(cfg.dishes_csv), vision, cfg)
    bot = Bot(cfg.bot_token)
    dp = Dispatcher()
    private, review = build(cfg, svc)
    dp.include_routers(private, review)
    task = asyncio.create_task(scheduler(bot, svc, cfg))
    try:
        await dp.start_polling(bot)
    finally:
        task.cancel()
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())

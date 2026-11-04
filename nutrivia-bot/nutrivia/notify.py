"""Уведомления клиенту приложения в Telegram — замена пушам: в PWA на iPhone их нет.

Привязка: в профиле «Подключить Telegram» → ссылка t.me/<бот>?start=app_<токен> (одноразовый, 15 минут) →
бот запоминает chat_id. Отвязать — в профиле или удалением аккаунта.

Что шлём (только привязавшим, не чаще раза в день на вид, повторы отсекает jobs_done):
- «Разбор проверен» — сразу, как специалист нажал «Отправить» (в приложении или в группе Telegram);
- 11:00 — фото ещё нет: напомнить про завтрак;
- 16:00 — «Совет на вечер»: остаток до ориентира и блюда из базы (их подбирает Engine, не модель);
- 20:00 — день ещё не засчитан в серию: сколько фото осталось, чтобы стадия голубики не опустилась.
"""
import logging
import secrets
from collections.abc import Awaitable, Callable
from datetime import datetime

from .config import ALMATY
from .db import Database

log = logging.getLogger(__name__)
LINK_TTL = 15 * 60
LINK_PREFIX = "app_"

# send(chat_id, text, path) — path: экран приложения для кнопки «Открыть» (/meal?id=…), может быть None
Send = Callable[[int, str, str | None], Awaitable[bool]]


async def new_link_token(db: Database, user_id: int) -> str:
    token = secrets.token_urlsafe(18)  # 24 символа: влезает в /start (до 64, только A-Z a-z 0-9 _ -)
    now = db.clock()
    await db.execute("DELETE FROM tg_link_tokens WHERE user_id = ? OR expires_at < ?", (user_id, now))
    await db.execute("INSERT INTO tg_link_tokens (token, user_id, expires_at) VALUES (?, ?, ?)",
                     (token, user_id, now + LINK_TTL))
    return token


async def consume_link(db: Database, payload: str | None, chat_id: int) -> int | None:
    """/start app_<токен> из бота → id пользователя приложения или None (чужое, просрочено, уже использовано)."""
    if not payload or not payload.startswith(LINK_PREFIX):
        return None
    token = payload[len(LINK_PREFIX):]
    row = await db.fetchone("SELECT * FROM tg_link_tokens WHERE token = ?", (token,))
    if row is None:
        return None
    await db.execute("DELETE FROM tg_link_tokens WHERE token = ?", (token,))
    if row["expires_at"] < db.clock() or await db.get_user(row["user_id"]) is None:
        return None
    await db.execute("INSERT OR REPLACE INTO tg_links (user_id, chat_id, linked_at) VALUES (?, ?, ?)",
                     (row["user_id"], chat_id, db.clock()))
    await db.log_event("tg_linked", row["user_id"])
    return row["user_id"]


async def chat_for(db: Database, user_id: int) -> int | None:
    row = await db.fetchone("SELECT chat_id FROM tg_links WHERE user_id = ?", (user_id,))
    return row["chat_id"] if row else None


async def unlink(db: Database, user_id: int) -> None:
    await db.execute("DELETE FROM tg_links WHERE user_id = ?", (user_id,))


def _kcal(items) -> int:
    return round(sum(i["kcal"] or 0 for i in items))


async def review_done(svc, meal_id: int, send: Send) -> bool:
    """«Разбор проверен» владельцу приёма пищи, если он привязал Telegram."""
    meal = await svc.db.fetchone("SELECT user_id FROM meals WHERE id = ?", (meal_id,))
    if meal is None:
        return False
    chat = await chat_for(svc.db, meal["user_id"])
    view = await svc.meal_view(meal_id, meal["user_id"])
    if chat is None or view is None:
        return False
    who = {"trainer": "Тренер", "nutritionist": "Нутрициолог"}.get((view.get("reviewer") or {}).get("role"), "Нутрициолог")
    names = ", ".join(i["name"] for i in view["items"][:4]).lower().capitalize()
    text = f"✅ {who} проверил разбор: {names} — {_kcal(view['items'])} ккал."
    if view.get("comment"):
        text += f"\n\n💬 {view['comment']}"
    return await send(chat, text, f"/meal?id={meal_id}")


async def due_reminders(svc, ts: int | None = None) -> list[tuple[int, str, str]]:
    """Что пора отправить сейчас: [(chat_id, текст, экран)]. Каждый вид — раз в день на человека."""
    ts = ts or svc.db.clock()
    local = datetime.fromtimestamp(ts, ALMATY)
    kind = {11: "breakfast", 16: "advice", 20: "streak"}.get(local.hour)
    if kind is None:
        return []
    out = []
    rows = await svc.db.fetchall(
        "SELECT l.user_id, l.chat_id FROM tg_links l JOIN users u ON u.tg_id = l.user_id WHERE u.role = 'client'")
    for r in rows:
        try:
            msg = await _reminder(svc, kind, r["user_id"], ts)
        except Exception:
            log.exception("reminder %s for %s failed", kind, r["user_id"])
            continue
        if msg and await svc.db.job_once(f"tg:{kind}:{r['user_id']}:{local.date().isoformat()}"):
            out.append((r["chat_id"], *msg))
    return out


async def _reminder(svc, kind: str, user_id: int, ts: int) -> tuple[str, str] | None:
    today = await svc.today_view(user_id, ts)
    if kind == "breakfast":
        if today["meals"]:
            return None
        return "🍳 Завтрак уже был? Сфотографируйте тарелку — разбор придёт сразу.", "/camera"
    if kind == "advice":
        advice = today.get("advice") or {}
        if not today["meals"] or not advice.get("options"):
            return None
        left = advice["remaining_kcal"]
        opts = ", ".join(o["name"].lower() for o in advice["options"])
        lead = "Белка пока немного — начните с белкового блюда." if advice.get("hint") == "protein" \
            else f"До ориентира ~{left} ккал." if left > 0 else "Ориентир на сегодня набран — если хочется есть, что-то лёгкое."
        return f"🌙 Совет на вечер. {lead}\nНапример: {opts}.", "/today"
    streak = await svc.streak_view(user_id, ts)
    if streak["today_counted"]:
        return None
    left = streak["min_photos"] - streak["photos_today"]
    word = "фото" if left == 1 else "фото еды"
    if streak["days"]:
        return (f"🫐 Серия {streak['days']} дн. — чтобы сегодня засчиталось, нужно ещё {left} {word}. "
                f"Пропуск — и голубика опустится на стадию."), "/camera"
    return f"🫐 Ещё {left} {word} — и сегодня засчитается в серию. Голубика ждёт.", "/camera"

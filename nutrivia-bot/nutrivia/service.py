"""Логика бота без Telegram: регистрация, фото → черновик, проверка, ответ, совет, итоги, оффер.
Telegram-слой (bot.py) только переводит сообщения и кнопки в вызовы этих методов."""
import json
import secrets
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from .advice import advice_text, weekly_text
from .config import ALMATY, Config
from .db import Database, local_day_bounds
from .drafts import apply_edits, build_items, format_client, format_review, make_item
from .engine import DishBase
from .matcher import Matcher, parse_edits
from .texts import GOALS, HEALTH_WORDS, HOME_PRODUCTS
from .vision import VisionProvider


@dataclass
class PhotoOutcome:
    status: str          # draft | not_food | limit | no_consent | no_user
    meal_id: int | None = None
    night: bool = False
    review_chat_id: int | None = None
    review_text: str = ""


class Service:
    def __init__(self, db: Database, base: DishBase, vision: VisionProvider, cfg: Config):
        self.db, self.base, self.vision, self.cfg = db, base, vision, cfg
        self.matcher = Matcher(base)

    # --- регистрация ---
    async def register(self, tg_id: int, lang: str, payload: str | None):
        """/start c_<код> или /start solo. Повторный /start не меняет группу."""
        user = await self.db.get_user(tg_id)
        if user is None:
            coach = None
            if payload and payload.startswith("c_"):
                coach = await self.db.get_coach(payload[2:])
            grp = "coach" if coach else "solo"
            await self.db.execute(
                "INSERT INTO users (tg_id, lang, grp, coach_code, joined_at) VALUES (?, ?, ?, ?, ?)",
                (tg_id, lang, grp, coach["code"] if coach else None, self.db.clock()))
            await self.db.log_event("user_joined", tg_id, group=grp, coach_id=coach["code"] if coach else None,
                                    payload=payload)
            user = await self.db.get_user(tg_id)
        return user, await self.db.get_coach(user["coach_code"])

    async def consent(self, tg_id: int) -> None:
        await self.db.update_user(tg_id, consent_at=self.db.clock())
        await self.db.log_event("consent", tg_id)

    async def set_goal(self, tg_id: int, goal: str) -> None:
        if goal not in GOALS:
            raise ValueError(goal)
        await self.db.update_user(tg_id, goal=goal, state="restrictions")

    async def set_restrictions(self, tg_id: int, text: str | None) -> None:
        await self.db.update_user(tg_id, restrictions=text, state=None)

    async def review_chat_for(self, user) -> int:
        """Группа нутрициолога, если он подключил Telegram-группу; иначе общая группа операторов."""
        coach = await self.db.get_coach(user["coach_code"])
        return (coach["review_chat_id"] if coach else 0) or self.cfg.solo_review_chat_id

    # --- фото → черновик ---
    async def receive_photo(self, tg_id: int, image: bytes, media_type: str = "image/jpeg",
                            ts: int | None = None) -> PhotoOutcome:
        ts = ts or self.db.clock()
        user = await self.db.get_user(tg_id)
        if user is None:
            return PhotoOutcome("no_user")
        if not user["consent_at"]:
            return PhotoOutcome("no_consent")
        if await self.over_limit(tg_id, ts):
            await self.db.log_event("photo_limit", tg_id)
            return PhotoOutcome("limit")

        meal_id = await self.db.execute("INSERT INTO meals (user_id, received_at) VALUES (?, ?)", (tg_id, ts))
        photo_dir = Path(self.cfg.photos_dir)
        photo_dir.mkdir(parents=True, exist_ok=True)
        photo_path = photo_dir / f"{tg_id}_{meal_id}.jpg"
        photo_path.write_bytes(image)
        await self.db.execute("UPDATE meals SET photo_path = ? WHERE id = ?", (str(photo_path), meal_id))
        hour = datetime.fromtimestamp(ts, ALMATY).hour
        night = not (self.cfg.work_start_hour <= hour < self.cfg.work_end_hour)
        await self.db.log_event("photo_received", tg_id, meal_id=meal_id, night=night)

        result = await self.vision.analyze(image, media_type)
        await self.db.execute(
            "INSERT INTO ai_requests (ts, user_id, meal_id, model, status, input_tokens, output_tokens, cost_usd,"
            " latency_ms, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (self.db.clock(), tg_id, meal_id, result.model, result.status, result.input_tokens, result.output_tokens,
             result.cost_usd, result.latency_ms, result.error or None))

        if result.status == "not_food":
            await self.db.execute("UPDATE meals SET status = 'failed', ai_draft = ? WHERE id = ?",
                                  (json.dumps(result.raw, ensure_ascii=False), meal_id))
            await self.db.log_event("not_food", tg_id, meal_id=meal_id)
            return PhotoOutcome("not_food", meal_id)

        # refusal/error — черновик пустой, человек заполняет вручную
        items = build_items(result.dishes, self.base, self.matcher)
        await self.db.replace_items(meal_id, items)
        await self.db.execute(
            "UPDATE meals SET status = 'draft', draft_at = ?, ai_draft = ?, review_chat_id = ? WHERE id = ?",
            (self.db.clock(), json.dumps(result.raw, ensure_ascii=False) if result.raw else None,
             await self.review_chat_for(user), meal_id))
        unmatched = [i["raw_name"] for i in items if not i["dish_id"]]
        await self.db.log_event("draft_ready", tg_id, meal_id=meal_id, latency_ms=result.latency_ms,
                                ai_cost=round(result.cost_usd, 5), ai_status=result.status, unmatched=unmatched)
        text = await self.review_text(meal_id)
        if result.status != "ok":
            text = f"⚠️ Модель не дала разбор ({result.status}). Заполните ответом «плов 300».\n\n" + text
        return PhotoOutcome("draft", meal_id, night, await self.review_chat_for(user), text)

    async def review_text(self, meal_id: int) -> str:
        meal = await self.db.fetchone("SELECT * FROM meals WHERE id = ?", (meal_id,))
        user = await self.db.get_user(meal["user_id"])
        coach = await self.db.get_coach(user["coach_code"])
        conf = {}
        if meal["ai_draft"]:
            conf = {d["name"]: d["confidence"] for d in json.loads(meal["ai_draft"]).get("dishes", [])}
        items = [dict(r) for r in await self.db.meal_items(meal_id)]
        return format_review(meal_id, user, coach["name"] if coach else None, items, self.base, conf, meal["comment"])

    async def set_review_message(self, meal_id: int, chat_id: int, msg_id: int) -> None:
        await self.db.execute("UPDATE meals SET review_chat_id = ?, review_msg_id = ? WHERE id = ?",
                              (chat_id, msg_id, meal_id))

    async def meal_by_review_message(self, chat_id: int, msg_id: int):
        return await self.db.fetchone("SELECT * FROM meals WHERE review_chat_id = ? AND review_msg_id = ?",
                                      (chat_id, msg_id))

    # --- проверяющий ---
    async def reviewer_edit(self, meal_id: int, text: str) -> list[str]:
        """Правка граммов. Возвращает названия, которые не нашли в базе."""
        items = [dict(r) for r in await self.db.meal_items(meal_id)]
        new_items, unknown = apply_edits(items, parse_edits(text), self.base, self.matcher)
        await self.db.replace_items(meal_id, new_items)
        return unknown

    async def reviewer_comment(self, meal_id: int, text: str) -> None:
        await self.db.execute("UPDATE meals SET comment = ? WHERE id = ?", (text.strip(), meal_id))

    async def reviewer_send(self, meal_id: int, reviewer_id: int) -> tuple[int, str] | None:
        """«Отправить»: фиксирует время проверки и возвращает (chat_id клиента, текст)."""
        meal = await self.db.fetchone("SELECT * FROM meals WHERE id = ?", (meal_id,))
        if meal is None or meal["status"] != "draft":
            return None
        user = await self.db.get_user(meal["user_id"])
        items = [dict(r) for r in await self.db.meal_items(meal_id)]
        if not items:
            return None
        ts = self.db.clock()
        await self.db.execute(
            "UPDATE meals SET status = 'sent', reviewer_id = ?, reviewed_at = ?, sent_at = ? WHERE id = ?",
            (reviewer_id, ts, ts, meal_id))
        before = {(d["name"]): d["grams"] for d in json.loads(meal["ai_draft"]).get("dishes", [])} \
            if meal["ai_draft"] else {}
        await self.db.log_event(
            "review_done", user["tg_id"], meal_id=meal_id, reviewer=reviewer_id,
            review_seconds=ts - (meal["draft_at"] or ts),
            grams_before=before,
            grams_after={i["raw_name"]: i["grams"] for i in items},
            items=[{"dish_id": i["dish_id"], "raw_name": i["raw_name"], "ai_grams": i["ai_grams"],
                    "grams": i["grams"]} for i in items])
        await self.db.log_event("reply_sent", user["tg_id"], meal_id=meal_id, total_latency=ts - meal["received_at"])
        return user["tg_id"], format_client(items, self.base, user["lang"], meal["comment"])

    # --- клиент ---
    async def client_confirm(self, tg_id: int, meal_id: int) -> bool:
        meal = await self.db.fetchone("SELECT * FROM meals WHERE id = ? AND user_id = ?", (meal_id, tg_id))
        if meal is None or meal["status"] != "sent":
            return False
        await self.db.execute("UPDATE meals SET status = 'confirmed' WHERE id = ?", (meal_id,))
        await self.db.log_event("client_confirmed", tg_id, meal_id=meal_id)
        return True

    async def start_correction(self, tg_id: int, meal_id: int) -> None:
        await self.db.update_user(tg_id, state=f"correction:{meal_id}")

    async def client_correction(self, tg_id: int, meal_id: int, text: str) -> tuple[str | None, bool]:
        """Правка клиента. Если удалось разобрать «плов 200» — пересчёт сразу (ответ клиенту, False).
        Иначе текст уходит проверяющему (None, True)."""
        await self.db.update_user(tg_id, state=None)
        edits = parse_edits(text)
        items = [dict(r) for r in await self.db.meal_items(meal_id)]
        user = await self.db.get_user(tg_id)
        if edits:
            new_items, unknown = apply_edits(items, edits, self.base, self.matcher)
            if not unknown:
                before = sum(i["kcal"] or 0 for i in items)
                await self.db.replace_items(meal_id, new_items)
                await self.db.execute("UPDATE meals SET status = 'corrected' WHERE id = ?", (meal_id,))
                after = sum(i["kcal"] or 0 for i in new_items)
                await self.db.log_event("client_corrected", tg_id, meal_id=meal_id, delta=round(after - before),
                                        text=text, auto=True)
                return format_client(new_items, self.base, user["lang"]), False
        await self.db.execute("UPDATE meals SET status = 'corrected' WHERE id = ?", (meal_id,))
        await self.db.log_event("client_corrected", tg_id, meal_id=meal_id, delta=None, text=text, auto=False)
        return None, True

    @staticmethod
    def is_health_complaint(text: str) -> bool:
        low = text.lower()
        return any(w in low for w in HEALTH_WORDS)

    async def delete_user(self, tg_id: int) -> None:
        for path in await self.db.delete_user(tg_id):
            Path(path).unlink(missing_ok=True)
        await self.db.log_event("deleted", tg_id)

    # --- расписание ---
    async def active_users(self):
        """Пользователи Telegram с согласием. WhatsApp-клиенты (отрицательный id) и пользователи
        приложения (channel = app) рассылок бота не получают."""
        return await self.db.fetchall("SELECT * FROM users WHERE consent_at IS NOT NULL AND tg_id > 0 AND channel = 'telegram'")

    async def over_limit(self, tg_id: int, ts: int | None = None) -> bool:
        start, end = local_day_bounds(ts)
        row = await self.db.fetchone(
            "SELECT COUNT(*) AS n FROM meals WHERE user_id = ? AND received_at >= ? AND received_at < ?",
            (tg_id, start, end))
        return row["n"] >= self.cfg.daily_photo_limit

    async def advice_for(self, user, ts: int | None = None, home: str | None = None) -> str:
        start, end = local_day_bounds(ts)
        eaten = await self.db.day_totals(user["tg_id"], start, end)
        allowed = HOME_PRODUCTS[home][1] if home else None
        return advice_text(user, eaten, self.base, allowed)

    async def due_advice(self, ts: int | None = None) -> list[tuple[int, str]]:
        ts = ts or self.db.clock()
        day = datetime.fromtimestamp(ts, ALMATY).date().isoformat()
        out = []
        for user in await self.active_users():
            recent = await self.db.fetchone(
                "SELECT 1 FROM meals WHERE user_id = ? AND received_at >= ? LIMIT 1",
                (user["tg_id"], local_day_bounds(ts, 2)[0]))
            if recent is None:
                continue
            if await self.db.job_once(f"advice:{day}:{user['tg_id']}"):
                out.append((user["tg_id"], await self.advice_for(user, ts)))
                await self.db.log_event("advice_sent", user["tg_id"], day=day)
        return out

    async def weekly_for(self, user, ts: int | None = None) -> str:
        days, counter = [], Counter()
        for back in range(7):
            start, end = local_day_bounds(ts, back)
            d = await self.db.day_totals(user["tg_id"], start, end)
            if d["meals"]:
                days.append(d)
        start, _ = local_day_bounds(ts, 6)
        _, end = local_day_bounds(ts)
        for r in await self.db.fetchall(
                "SELECT i.dish_id FROM meal_items i JOIN meals m ON m.id = i.meal_id WHERE m.user_id = ?"
                " AND m.received_at >= ? AND m.received_at < ? AND m.status IN ('sent','confirmed','corrected')"
                " AND i.dish_id IS NOT NULL", (user["tg_id"], start, end)):
            counter[r["dish_id"]] += 1
        return weekly_text(user, days, counter, self.base)

    async def due_weekly(self, ts: int | None = None) -> list[tuple[int, str]]:
        ts = ts or self.db.clock()
        day = datetime.fromtimestamp(ts, ALMATY).date().isoformat()
        out = []
        for user in await self.active_users():
            if await self.db.job_once(f"weekly:{day}:{user['tg_id']}"):
                out.append((user["tg_id"], await self.weekly_for(user, ts)))
                await self.db.log_event("weekly_report_sent", user["tg_id"], day=day)
        return out

    async def due_offers(self, ts: int | None = None) -> list:
        """«Одиночки» на offer_day-й день участия. Нутрициологам счёт выставляем вручную."""
        ts = ts or self.db.clock()
        out = []
        for user in await self.active_users():
            day_n = (ts - user["joined_at"]) // 86400 + 1
            if user["grp"] == "solo" and day_n >= self.cfg.offer_day and not user["offered_at"]:
                await self.db.update_user(user["tg_id"], offered_at=ts)
                await self.db.log_event("payment_link_sent", user["tg_id"], day=day_n,
                                        price=self.cfg.offer_price_kzt, kaspi=bool(self.cfg.kaspi_pay_url))
                out.append(user)
        return out

    async def mark_paid(self, tg_id: int, amount: int, by: int) -> bool:
        if await self.db.get_user(tg_id) is None:
            return False
        await self.db.update_user(tg_id, paid_at=self.db.clock())
        await self.db.log_event("paid", tg_id, amount=amount, confirmed_by=by)
        return True

    # --- приложение (канал app); вход по SMS — nutrivia/auth.py ---
    APP_ID_BASE = 9_000_000_000_000  # id пользователей приложения не пересекаются с Telegram id

    async def meal_view(self, meal_id: int, user_id: int) -> dict | None:
        meal = await self.db.fetchone("SELECT * FROM meals WHERE id = ? AND user_id = ?", (meal_id, user_id))
        if meal is None:
            return None
        conf = {}
        if meal["ai_draft"]:
            conf = {d["name"]: d.get("confidence") for d in json.loads(meal["ai_draft"]).get("dishes", [])}
        items = []
        for r in await self.db.meal_items(meal_id):
            dish = self.base.get(r["dish_id"])
            items.append({
                "dish_id": r["dish_id"], "raw_name": r["raw_name"],
                "name": dish.name_ru if dish else r["raw_name"],
                "grams": r["grams"], "ai_grams": r["ai_grams"], "portion": r["portion"],
                "unit": dish.unit if dish else None,
                "unit_grams": dish.unit_grams if dish else None,
                "kcal": r["kcal"], "protein": r["protein"], "fat": r["fat"], "carbs": r["carbs"],
                "confidence": conf.get(r["raw_name"]), "in_base": dish is not None,
            })
        status = {"received": "draft", "draft": "draft", "sent": "reviewed", "confirmed": "reviewed",
                  "corrected": "reviewed", "failed": "not_food"}[meal["status"]]
        if meal["status"] == "corrected" and not meal["reviewed_at"]:
            status = "draft"
        reviewed = status == "reviewed"
        return {"id": meal["id"], "status": status, "received_at": meal["received_at"], "items": items,
                # черновик комментария проверяющего клиенту не показываем — только после «Отправить»
                "comment": meal["comment"] if reviewed else None,
                "reviewed_at": meal["reviewed_at"] if reviewed else None,
                "reviewer": await self._reviewer(meal["reviewer_id"]) if reviewed else None,
                "has_photo": bool(meal["photo_path"])}

    async def _reviewer(self, reviewer_id: int | None) -> dict:
        """Кто проверил: специалист из приложения — по имени; оператор из Telegram — «Нутрициолог Nutrivia»."""
        if reviewer_id:
            row = await self.db.fetchone(
                "SELECT c.name, u.role FROM pros p JOIN coaches c ON c.code = p.code JOIN users u ON u.tg_id = p.user_id"
                " WHERE p.user_id = ?", (reviewer_id,))
            if row:
                return {"name": row["name"], "role": row["role"]}
        return {"name": "Нутрициолог Nutrivia", "role": "operator"}

    async def set_items(self, meal_id: int, user_id: int, items: list[tuple[str, float]]) -> bool:
        """Правка клиента в приложении: порции блюд из базы. Пересчёт — только Engine."""
        meal = await self.db.fetchone("SELECT * FROM meals WHERE id = ? AND user_id = ?", (meal_id, user_id))
        if meal is None or meal["status"] == "failed":
            return False
        old = [dict(r) for r in await self.db.meal_items(meal_id)]
        ai = {o["dish_id"]: o["ai_grams"] for o in old}
        names = {o["dish_id"]: o["raw_name"] for o in old}
        new = []
        for dish_id, grams in items:
            dish = self.base.get(dish_id)
            if dish is None or not 0 < grams <= 3000:
                return False
            new.append(make_item(names.get(dish_id, dish.name_ru), grams, self.base, self.matcher,
                                 ai_grams=ai.get(dish_id), dish_id=dish_id))
        # блюда не из базы клиент поправить не может — их оставляет проверяющий
        new += [o for o in old if not o["dish_id"]]
        before = sum(o["kcal"] or 0 for o in old)
        await self.db.replace_items(meal_id, new)
        after = sum(i["kcal"] or 0 for i in new)
        if round(after) != round(before):
            await self.db.log_event("client_corrected", user_id, meal_id=meal_id, delta=round(after - before),
                                    auto=True, channel="app")
            if meal["status"] in ("sent", "confirmed"):
                await self.db.execute("UPDATE meals SET status = 'corrected' WHERE id = ?", (meal_id,))
        return True

    async def app_confirm(self, meal_id: int, user_id: int) -> bool:
        meal = await self.db.fetchone("SELECT * FROM meals WHERE id = ? AND user_id = ?", (meal_id, user_id))
        if meal is None or meal["status"] == "failed":
            return False
        if meal["status"] == "sent":
            await self.db.execute("UPDATE meals SET status = 'confirmed' WHERE id = ?", (meal_id,))
        await self.db.log_event("client_confirmed", user_id, meal_id=meal_id, channel="app",
                                before_review=meal["status"] == "draft")
        return True

    async def today_view(self, user_id: int, ts: int | None = None) -> dict:
        """Итоги дня по всем разборам, включая черновики: клиент видит оценку сразу, с пометкой статуса."""
        start, end = local_day_bounds(ts)
        rows = await self.db.fetchall(
            "SELECT id FROM meals WHERE user_id = ? AND received_at >= ? AND received_at < ? AND status != 'failed'"
            " ORDER BY received_at DESC", (user_id, start, end))
        meals = [await self.meal_view(r["id"], user_id) for r in rows]
        tot = {"kcal": 0.0, "protein": 0.0, "fat": 0.0, "carbs": 0.0}
        for m in meals:
            for i in m["items"]:
                for k in tot:
                    tot[k] += i[k] or 0
        user = await self.db.get_user(user_id)
        from .advice import targets_for
        kcal_target, protein_target = targets_for(user)
        return {"meals": meals, "totals": {k: round(v, 1) for k, v in tot.items()},
                "targets": {"kcal": kcal_target, "protein": protein_target}}

    # --- серия и неделя (приложение) ---
    STAGE_DAYS = (0, 3, 7, 14, 30)  # пороги стадий маскота, черновик — утверждает фаундер
    MIN_PHOTOS_PER_DAY = 2          # день засчитывается в серию при стольких фото еды

    @classmethod
    def stage_for(cls, days: int) -> int:
        return max(i + 1 for i, d in enumerate(cls.STAGE_DAYS) if days >= d)

    async def _photos_by_day(self, user_id: int) -> dict:
        from datetime import datetime
        rows = await self.db.fetchall(
            "SELECT received_at FROM meals WHERE user_id = ? AND status != 'failed'", (user_id,))
        counts: dict = {}
        for r in rows:
            day = datetime.fromtimestamp(r["received_at"], ALMATY).date()
            counts[day] = counts.get(day, 0) + 1
        return counts

    async def streak_view(self, user_id: int, ts: int | None = None) -> dict:
        """Серия идёт от дня регистрации. Засчитанный день: +1 к серии, стадия растёт по порогам.
        Пропущенный день: серия с нуля, маскот опускается на одну стадию (не в ноль).
        Сегодня ещё не закончилось — пока фото мало, серию не обрывает."""
        from datetime import datetime, timedelta
        ts = ts or self.db.clock()
        user = await self.db.get_user(user_id)
        counts = await self._photos_by_day(user_id)
        today = datetime.fromtimestamp(ts, ALMATY).date()
        day = datetime.fromtimestamp(user["joined_at"], ALMATY).date()
        streak, stage, best = 0, 1, 0
        while day <= today:
            counted = counts.get(day, 0) >= self.MIN_PHOTOS_PER_DAY
            if counted:
                streak += 1
                stage = max(stage, self.stage_for(streak))
            elif day < today:
                streak = 0
                stage = max(1, stage - 1)
            best = max(best, streak)
            day += timedelta(days=1)
        # следующая стадия — порог по индексу текущей (после пропуска стадия может быть выше, чем дала бы серия)
        next_days = self.STAGE_DAYS[stage] if stage < len(self.STAGE_DAYS) else None
        photos_today = counts.get(today, 0)
        return {
            "days": streak, "best": best, "stage": stage, "stage_days": list(self.STAGE_DAYS),
            "next_stage_in": max(1, next_days - streak) if next_days is not None else None,
            "photos_today": photos_today, "min_photos": self.MIN_PHOTOS_PER_DAY,
            "today_counted": photos_today >= self.MIN_PHOTOS_PER_DAY,
        }

    async def week_view(self, user_id: int, ts: int | None = None) -> dict:
        """Последние 7 дней по Алматы, по записанному рациону (черновики тоже — с пометкой у приёмов)."""
        from datetime import datetime
        ts = ts or self.db.clock()
        user = await self.db.get_user(user_id)
        days = []
        for back in range(6, -1, -1):
            start, end = local_day_bounds(ts, back)
            row = await self.db.fetchone(
                "SELECT COUNT(DISTINCT m.id) AS meals, COALESCE(SUM(i.kcal),0) AS kcal, COALESCE(SUM(i.protein),0) AS protein"
                " FROM meals m LEFT JOIN meal_items i ON i.meal_id = m.id"
                " WHERE m.user_id = ? AND m.received_at >= ? AND m.received_at < ? AND m.status != 'failed'",
                (user_id, start, end))
            d = datetime.fromtimestamp(start, ALMATY)
            days.append({"date": d.date().isoformat(), "weekday": d.weekday(), "meals": row["meals"],
                         "kcal": round(row["kcal"]), "protein": round(row["protein"], 1)})
        logged = [d for d in days if d["meals"]]
        week_start, _ = local_day_bounds(ts, 6)
        reviewed = await self.db.fetchone(
            "SELECT COUNT(*) AS n FROM meals WHERE user_id = ? AND received_at >= ? AND reviewed_at IS NOT NULL",
            (user_id, week_start))
        comment = await self.db.fetchone(
            "SELECT comment FROM meals WHERE user_id = ? AND received_at >= ? AND comment IS NOT NULL"
            " ORDER BY reviewed_at DESC, received_at DESC LIMIT 1", (user_id, week_start))
        coach = await self.db.get_coach(user["coach_code"])
        from .advice import targets_for
        kcal_target, protein_target = targets_for(user)
        return {
            "days": days,
            "logged_days": len(logged),
            "avg_kcal": round(sum(d["kcal"] for d in logged) / len(logged)) if logged else None,
            "avg_protein": round(sum(d["protein"] for d in logged) / len(logged)) if logged else None,
            "reviewed_photos": reviewed["n"],
            "targets": {"kcal": kcal_target, "protein": protein_target},
            "coach": {"name": coach["name"] if coach else None, "comment": comment["comment"] if comment else None},
        }


    # --- типы аккаунтов в приложении: для себя, тренер, нутрициолог ---
    PRO_ROLES = ("trainer", "nutritionist")
    STUDENT_LIMIT = {"trainer": 5}  # тренер ведёт до 5 учеников (Алан, 27.10); у нутрициолога лимита пока нет

    async def create_app_user(self, role: str, lang: str, goal: str | None, name: str | None) -> dict:
        """Новый пользователь приложения. Согласие проверяет вызывающий код (экран входа)."""
        if role not in ("client", *self.PRO_ROLES):
            raise ValueError(role)
        last = await self.db.fetchone("SELECT MAX(tg_id) AS m FROM users WHERE channel = 'app'")
        uid = max(last["m"] or 0, self.APP_ID_BASE) + 1
        ts = self.db.clock()
        await self.db.execute(
            "INSERT INTO users (tg_id, lang, grp, joined_at, consent_at, goal, channel, role)"
            " VALUES (?, ?, 'solo', ?, ?, ?, 'app', ?)",
            (uid, lang if lang in ("ru", "kk") else "ru", ts, ts, goal if goal in GOALS else None, role))
        if role in self.PRO_ROLES:
            # Специалист — это «нутрициолог» в смысле бота: его код приглашения = код в таблице coaches.
            # Telegram-группы у него нет (review_chat_id = 0) — разборы его учеников идут операторам.
            code = None
            for _ in range(20):
                candidate = "".join(secrets.choice("abcdefghjkmnpqrstuvwxyz23456789") for _ in range(6))
                if not await self.db.get_coach(candidate):
                    code = candidate
                    break
            await self.db.execute("INSERT INTO coaches (code, name, review_chat_id) VALUES (?, ?, 0)",
                                  (code, (name or "").strip()[:60] or "Специалист", ))
            await self.db.execute("INSERT INTO pros (user_id, code) VALUES (?, ?)", (uid, code))
        await self.db.log_event("user_joined", uid, group="solo", channel="app", role=role)
        await self.db.log_event("consent", uid, channel="app")
        return await self.db.get_user(uid)

    async def pro_code(self, user_id: int) -> str | None:
        row = await self.db.fetchone("SELECT code FROM pros WHERE user_id = ?", (user_id,))
        return row["code"] if row else None

    async def join_coach(self, user_id: int, invite_code: str) -> str:
        """Клиент вводит код тренера или нутрициолога. Возвращает статус: ok | not_found | full | not_client."""
        user = await self.db.get_user(user_id)
        if user["role"] != "client":
            return "not_client"
        code = (invite_code or "").strip().lower()
        coach = await self.db.get_coach(code)
        if coach is None:
            return "not_found"
        pro = await self.db.fetchone("SELECT u.role FROM pros p JOIN users u ON u.tg_id = p.user_id WHERE p.code = ?", (code,))
        limit = self.STUDENT_LIMIT.get(pro["role"]) if pro else None
        if limit is not None and user["coach_code"] != code:
            n = await self.db.fetchone("SELECT COUNT(*) AS n FROM users WHERE coach_code = ?", (code,))
            if n["n"] >= limit:
                return "full"
        await self.db.update_user(user_id, coach_code=code, grp="coach")
        await self.db.log_event("coach_joined", user_id, coach_id=code)
        return "ok"

    async def me_view(self, user_id: int) -> dict:
        user = await self.db.get_user(user_id)
        coach = await self.db.get_coach(user["coach_code"])
        view = {"user_id": user_id, "role": user["role"], "goal": user["goal"], "lang": user["lang"],
                "coach": {"name": coach["name"], "code": coach["code"]} if coach else None}
        code = await self.pro_code(user_id)
        if code:
            pro = await self.db.get_coach(code)
            n = await self.db.fetchone("SELECT COUNT(*) AS n FROM users WHERE coach_code = ?", (code,))
            view["pro"] = {"name": pro["name"], "invite_code": code, "students": n["n"],
                           "limit": self.STUDENT_LIMIT.get(user["role"])}
        return view

    async def students_view(self, pro_user_id: int) -> list[dict] | None:
        """Ученики специалиста: калории за сегодня и сколько разборов ждут проверки."""
        code = await self.pro_code(pro_user_id)
        if code is None:
            return None
        start, end = local_day_bounds()
        out = []
        for u in await self.db.fetchall("SELECT * FROM users WHERE coach_code = ? ORDER BY joined_at, tg_id", (code,)):
            totals = await self.db.fetchone(
                "SELECT COUNT(DISTINCT m.id) AS meals, COALESCE(SUM(i.kcal),0) AS kcal FROM meals m"
                " LEFT JOIN meal_items i ON i.meal_id = m.id WHERE m.user_id = ? AND m.received_at >= ?"
                " AND m.received_at < ? AND m.status != 'failed'", (u["tg_id"], start, end))
            drafts = await self.db.fetchone(
                "SELECT COUNT(*) AS n FROM meals WHERE user_id = ? AND status = 'draft'", (u["tg_id"],))
            from .advice import targets_for
            kcal_target, _ = targets_for(u)
            streak = await self.streak_view(u["tg_id"])
            out.append({"user_id": u["tg_id"], "label": f"Ученик {len(out) + 1}", "goal": u["goal"],
                        "meals_today": totals["meals"], "kcal_today": round(totals["kcal"]),
                        "kcal_target": kcal_target, "pending_reviews": drafts["n"], "streak_days": streak["days"]})
        return out

    # --- проверка разборов специалистом в приложении ---

    async def student_labels(self, code: str) -> dict[int, str]:
        """«Ученик N» по порядку подключения — те же номера, что в списке учеников."""
        rows = await self.db.fetchall("SELECT tg_id FROM users WHERE coach_code = ? ORDER BY joined_at, tg_id", (code,))
        return {r["tg_id"]: f"Ученик {i + 1}" for i, r in enumerate(rows)}

    async def pro_meal(self, pro_user_id: int, meal_id: int):
        """Приём пищи ученика этого специалиста или None (чужие разборы не видны)."""
        code = await self.pro_code(pro_user_id)
        if code is None:
            return None
        return await self.db.fetchone(
            "SELECT m.* FROM meals m JOIN users u ON u.tg_id = m.user_id WHERE m.id = ? AND u.coach_code = ?",
            (meal_id, code))

    async def pro_queue(self, pro_user_id: int) -> list[dict] | None:
        """Черновики учеников, старые сверху: их и надо проверить первыми (обещание — 15 минут)."""
        code = await self.pro_code(pro_user_id)
        if code is None:
            return None
        labels = await self.student_labels(code)
        rows = await self.db.fetchall(
            "SELECT m.id, m.user_id FROM meals m JOIN users u ON u.tg_id = m.user_id"
            " WHERE u.coach_code = ? AND m.status = 'draft' ORDER BY m.received_at", (code,))
        out = []
        for r in rows:
            view = await self.meal_view(r["id"], r["user_id"])
            out.append({**view, "student": labels.get(r["user_id"], "Ученик"), "student_id": r["user_id"]})
        return out

    async def pro_meal_view(self, pro_user_id: int, meal_id: int) -> dict | None:
        meal = await self.pro_meal(pro_user_id, meal_id)
        if meal is None:
            return None
        labels = await self.student_labels(await self.pro_code(pro_user_id))
        student = await self.db.get_user(meal["user_id"])
        view = await self.meal_view(meal_id, meal["user_id"])
        return {**view, "student": labels.get(meal["user_id"], "Ученик"), "student_id": meal["user_id"],
                "student_goal": student["goal"], "student_restrictions": student["restrictions"]}

    async def pro_set_items(self, pro_user_id: int, meal_id: int, items: list[tuple[str, float]]) -> bool:
        """Правка проверяющим: полный список блюд из базы. Оценка модели (ai_grams) сохраняется для метрики."""
        meal = await self.pro_meal(pro_user_id, meal_id)
        if meal is None or meal["status"] != "draft":
            return False
        old = [dict(r) for r in await self.db.meal_items(meal_id)]
        ai = {o["dish_id"]: o["ai_grams"] for o in old if o["dish_id"]}
        names = {o["dish_id"]: o["raw_name"] for o in old if o["dish_id"]}
        new = []
        for dish_id, grams in items:
            dish = self.base.get(dish_id)
            if dish is None or not 0 < grams <= 3000:
                return False
            new.append(make_item(names.get(dish_id, dish.name_ru), grams, self.base, self.matcher,
                                 ai_grams=ai.get(dish_id), dish_id=dish_id))
        # блюда не из базы проверяющий заменяет блюдом из базы — тогда старое убирается из списка
        await self.db.replace_items(meal_id, new)
        await self.db.log_event("review_edit", meal["user_id"], meal_id=meal_id, reviewer=pro_user_id, channel="app")
        return True

    async def pro_comment(self, pro_user_id: int, meal_id: int, text: str) -> bool:
        meal = await self.pro_meal(pro_user_id, meal_id)
        if meal is None or meal["status"] != "draft":
            return False
        await self.reviewer_comment(meal_id, text[:1000])
        return True

    async def pro_send(self, pro_user_id: int, meal_id: int) -> str:
        """«Отправить»: ok | not_found | already_sent | empty. Тот же reviewer_send, что у кнопки в Telegram."""
        meal = await self.pro_meal(pro_user_id, meal_id)
        if meal is None:
            return "not_found"
        if meal["status"] != "draft":
            return "already_sent"
        if any(not r["dish_id"] for r in await self.db.meal_items(meal_id)):
            return "unmatched"
        res = await self.reviewer_send(meal_id, pro_user_id)
        return "ok" if res else "empty"

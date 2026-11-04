"""Логика бота без Telegram: регистрация, фото → черновик, проверка, ответ, совет, итоги, оффер.
Telegram-слой (bot.py) только переводит сообщения и кнопки в вызовы этих методов."""
import hashlib
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
from .engine import DishBase, compute
from .matcher import Matcher, parse_edits
from .texts import GOALS, HEALTH_WORDS, HOME_PRODUCTS
from .vision import VisionProvider, VisionResult, parse_payload


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

        result = await self._recognize(tg_id, meal_id, image, media_type, ts)
        if result.model not in ("cache", "budget"):
            await self.db.execute(
            "INSERT INTO ai_requests (ts, user_id, meal_id, model, status, input_tokens, output_tokens, cost_usd,"
            " latency_ms, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (self.db.clock(), tg_id, meal_id, result.model, result.status, result.input_tokens,
                 result.output_tokens, result.cost_usd, result.latency_ms, result.error or None))

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

    async def ai_spent_today(self) -> float:
        start, end = local_day_bounds(self.db.clock())
        row = await self.db.fetchone("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM ai_requests WHERE ts >= ? AND ts < ?",
                                     (start, end))
        return row["c"]

    async def ai_over_budget(self) -> bool:
        return bool(self.cfg.ai_daily_usd) and await self.ai_spent_today() >= self.cfg.ai_daily_usd

    async def _recognize(self, tg_id: int, meal_id: int, image: bytes, media_type: str, ts: int) -> VisionResult:
        """Фото → разбор. То же фото за сутки — берём прошлый разбор без оплаты (model=cache).
        Дневной потолок трат исчерпан — модель не зовём, черновик пустой, его заполнит человек (model=budget)."""
        digest = hashlib.sha256(image).hexdigest()
        await self.db.execute("UPDATE meals SET photo_hash = ? WHERE id = ?", (digest, meal_id))
        prev = await self.db.fetchone(
            "SELECT ai_draft FROM meals WHERE user_id = ? AND photo_hash = ? AND id != ? AND received_at >= ?"
            " AND ai_draft IS NOT NULL ORDER BY id DESC LIMIT 1", (tg_id, digest, meal_id, ts - 86400))
        if prev:
            payload = json.loads(prev["ai_draft"])
            dishes = parse_payload(payload)
            await self.db.log_event("vision_cache_hit", tg_id, meal_id=meal_id)
            return VisionResult(status="ok" if payload.get("is_food") and dishes else "not_food",
                                dishes=dishes, model="cache", raw=payload)
        if await self.ai_over_budget():
            await self.db.log_event("ai_budget_hit", tg_id, meal_id=meal_id)
            return VisionResult(status="error", model="budget", error="daily budget")
        return await self.vision.analyze(image, media_type)

    async def fridge(self, user_id: int, image: bytes, media_type: str) -> dict:
        """Фото холодильника → продукты → блюда из базы под остаток калорий. Status: ok | empty | budget | error."""
        from .advice import targets_for
        from .fridge import ideas_for
        if await self.ai_over_budget():
            return {"status": "budget", "products": [], "ideas": []}
        res = await self.vision.analyze_products(image, media_type)
        r = res.request
        if r.model != "fake":
            await self.db.execute(
                "INSERT INTO ai_requests (ts, user_id, meal_id, model, status, input_tokens, output_tokens, cost_usd,"
                " latency_ms, error) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)",
                (self.db.clock(), user_id, r.model, f"fridge_{r.status}", r.input_tokens, r.output_tokens,
                 r.cost_usd, r.latency_ms, r.error or None))
        if r.status != "ok":
            return {"status": "error", "products": [], "ideas": []}
        return await self.fridge_ideas(user_id, res.products)

    async def fridge_ideas(self, user_id: int, products: list[str]) -> dict:
        """Блюда под список продуктов без ИИ: человек убрал лишнее или дописал своё."""
        from .advice import targets_for
        from .fridge import ideas_for
        today = await self.today_view(user_id)
        user = await self.db.get_user(user_id)
        kcal_target, protein_target = targets_for(user)
        remaining = kcal_target - today["totals"]["kcal"]
        ideas = ideas_for(products, self.base, remaining, today["totals"]["protein"] < protein_target * 0.7)
        await self.db.log_event("fridge", user_id, products=len(products), ideas=len(ideas))
        return {"status": "ok" if products else "empty", "products": products, "ideas": ideas,
                "remaining_kcal": round(remaining)}

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

    async def export_user(self, tg_id: int) -> dict:
        """Выгрузка данных человека (право на доступ к своим данным)."""
        user = dict(await self.db.get_user(tg_id))
        meals = []
        for r in await self.db.fetchall("SELECT id FROM meals WHERE user_id = ? ORDER BY received_at", (tg_id,)):
            m = await self.meal_view(r["id"], tg_id)
            m["received_at"] = datetime.fromtimestamp(m["received_at"], ALMATY).isoformat()
            meals.append(m)
        weights = await self.db.fetchall("SELECT ts, kg FROM weights WHERE user_id = ? ORDER BY ts", (tg_id,))
        keep = ("role", "goal", "lang", "sex", "birth_year", "height_cm", "weight_kg", "activity", "kcal_target")
        return {
            "exported_at": datetime.fromtimestamp(self.db.clock(), ALMATY).isoformat(),
            "profile": {k: user.get(k) for k in keep},
            "joined_at": datetime.fromtimestamp(user["joined_at"], ALMATY).isoformat(),
            "meals": meals,
            "weights": [{"at": datetime.fromtimestamp(w["ts"], ALMATY).isoformat(), "kg": w["kg"]} for w in weights],
        }

    # --- подписка (Kaspi по ссылке, подтверждает команда) ---
    PAID_DAYS = 30

    async def subscription(self, user_id: int) -> dict:
        """trial (дней осталось) | active (до даты) | expired. Специалисты и операторы — бесплатно (free)."""
        u = await self.db.get_user(user_id)
        now_ts = self.db.clock()
        pending = await self.db.fetchone("SELECT 1 FROM payments WHERE user_id = ? AND status = 'pending'", (user_id,))
        base = {"price_kzt": self.cfg.offer_price_kzt, "pay_url": self.cfg.kaspi_pay_url or None,
                "pending": bool(pending), "enforced": self.cfg.paywall_enforce}
        if u["role"] != "client":
            return {**base, "status": "free"}
        if u["paid_until"] and u["paid_until"] > now_ts:
            return {**base, "status": "active",
                    "until": datetime.fromtimestamp(u["paid_until"], ALMATY).date().isoformat()}
        trial_end = u["joined_at"] + self.cfg.trial_days * 86400
        if trial_end > now_ts:
            return {**base, "status": "trial", "days_left": max(1, round((trial_end - now_ts) / 86400))}
        return {**base, "status": "expired"}

    async def can_upload(self, user_id: int) -> bool:
        return not self.cfg.paywall_enforce or (await self.subscription(user_id))["status"] != "expired"

    async def claim_payment(self, user_id: int) -> None:
        """«Я оплатил» — заявка команде; одна открытая за раз."""
        if not await self.db.fetchone("SELECT 1 FROM payments WHERE user_id = ? AND status = 'pending'", (user_id,)):
            await self.db.execute("INSERT INTO payments (user_id, ts, amount_kzt) VALUES (?, ?, ?)",
                                  (user_id, self.db.clock(), self.cfg.offer_price_kzt))
            await self.db.log_event("payment_claimed", user_id)

    async def decide_payment(self, payment_id: int, confirm: bool) -> bool:
        """Админ: подтвердить (+30 дней от сегодня или от конца оплаченного) или отклонить."""
        p = await self.db.fetchone("SELECT * FROM payments WHERE id = ? AND status = 'pending'", (payment_id,))
        if p is None:
            return False
        now_ts = self.db.clock()
        await self.db.execute("UPDATE payments SET status = ?, decided_at = ? WHERE id = ?",
                              ("confirmed" if confirm else "rejected", now_ts, payment_id))
        if confirm:
            u = await self.db.get_user(p["user_id"])
            start = max(now_ts, u["paid_until"] or 0)
            await self.db.update_user(p["user_id"], paid_until=start + self.PAID_DAYS * 86400, paid_at=now_ts)
            await self.db.log_event("paid", p["user_id"], channel="app", amount=p["amount_kzt"])
        return True

    async def pending_payments(self, phones: dict[int, str]) -> list[dict]:
        rows = await self.db.fetchall("SELECT * FROM payments WHERE status = 'pending' ORDER BY ts")
        return [{"id": r["id"], "user_id": r["user_id"], "amount_kzt": r["amount_kzt"],
                 "phone": (lambda ph: ph[:4] + " *** ** " + ph[-4:-2] + " " + ph[-2:] if ph else "")(phones.get(r["user_id"], "")),
                 "at": datetime.fromtimestamp(r["ts"], ALMATY).strftime("%d.%m %H:%M")} for r in rows]

    # --- лента ---
    async def _author_label(self, user_id: int) -> str:
        streak = await self.streak_view(user_id)
        return f"Участник · серия {streak['days']}" if streak["days"] else "Участник"

    async def _post_view(self, row, viewer_id: int) -> dict:
        likes = await self.db.fetchone("SELECT COUNT(*) AS n, SUM(user_id = ?) AS me FROM post_likes WHERE post_id = ?",
                                       (viewer_id, row["id"]))
        meal = None
        if row["meal_id"]:
            m = await self.meal_view(row["meal_id"], row["user_id"])
            if m:
                meal = {"items": [i["name"] for i in m["items"]], "kcal": round(sum(i["kcal"] or 0 for i in m["items"])),
                        "protein": round(sum(i["protein"] or 0 for i in m["items"]), 1), "has_photo": m["has_photo"]}
        return {"id": row["id"], "kind": row["kind"], "text": row["text"], "meal": meal,
                "at": datetime.fromtimestamp(row["ts"], ALMATY).strftime("%d.%m %H:%M"),
                "author": await self._author_label(row["user_id"]), "mine": row["user_id"] == viewer_id,
                "likes": likes["n"], "liked": bool(likes["me"]), "hidden": bool(row["hidden"])}

    async def feed(self, viewer_id: int, kind: str | None = None, before: int | None = None, limit: int = 20) -> list[dict]:
        rows = await self.db.fetchall(
            "SELECT * FROM posts WHERE hidden = 0 AND (? IS NULL OR kind = ?) AND (? IS NULL OR id < ?)"
            " ORDER BY id DESC LIMIT ?", (kind, kind, before, before, limit))
        return [await self._post_view(r, viewer_id) for r in rows]

    async def add_post(self, user_id: int, kind: str, text: str, meal_id: int | None) -> tuple[str, dict | None]:
        """Status: ok | bad_text:<причина> | bad_meal."""
        from .feed import check_text
        problem = check_text(text)
        if problem:
            return f"bad_text:{problem}", None
        if meal_id is not None and not await self.db.fetchone(
                "SELECT 1 FROM meals WHERE id = ? AND user_id = ?", (meal_id, user_id)):
            return "bad_meal", None
        pid = await self.db.execute("INSERT INTO posts (user_id, kind, text, meal_id, ts) VALUES (?, ?, ?, ?, ?)",
                                    (user_id, kind, text.strip()[:1000], meal_id, self.db.clock()))
        await self.db.log_event("post", user_id, kind=kind, with_meal=meal_id is not None)
        return "ok", await self._post_view(await self.db.fetchone("SELECT * FROM posts WHERE id = ?", (pid,)), user_id)

    async def toggle_like(self, user_id: int, post_id: int) -> dict | None:
        post = await self.db.fetchone("SELECT * FROM posts WHERE id = ? AND hidden = 0", (post_id,))
        if post is None:
            return None
        if await self.db.fetchone("SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?", (post_id, user_id)):
            await self.db.execute("DELETE FROM post_likes WHERE post_id = ? AND user_id = ?", (post_id, user_id))
        else:
            await self.db.execute("INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)", (post_id, user_id))
        return await self._post_view(post, user_id)

    async def report_post(self, user_id: int, post_id: int) -> bool:
        from .feed import HIDE_AFTER_REPORTS
        if not await self.db.fetchone("SELECT 1 FROM posts WHERE id = ?", (post_id,)):
            return False
        await self.db.execute("INSERT OR IGNORE INTO post_reports (post_id, user_id, ts) VALUES (?, ?, ?)",
                              (post_id, user_id, self.db.clock()))
        n = await self.db.fetchone("SELECT COUNT(*) AS n FROM post_reports WHERE post_id = ?", (post_id,))
        if n["n"] >= HIDE_AFTER_REPORTS:
            await self.db.execute("UPDATE posts SET hidden = 1 WHERE id = ?", (post_id,))
        await self.db.log_event("post_report", user_id, post_id=post_id)
        return True

    async def delete_post(self, user_id: int, post_id: int) -> bool:
        post = await self.db.fetchone("SELECT * FROM posts WHERE id = ?", (post_id,))
        if post is None or (post["user_id"] != user_id and not await self._is_operator(user_id)):
            return False
        for table in ("post_likes", "post_reports"):
            await self.db.execute(f"DELETE FROM {table} WHERE post_id = ?", (post_id,))
        await self.db.execute("DELETE FROM posts WHERE id = ?", (post_id,))
        return True

    async def _is_operator(self, user_id: int) -> bool:
        u = await self.db.get_user(user_id)
        return u is not None and u["role"] == "operator"

    async def reported_posts(self, operator_id: int) -> list[dict] | None:
        """Очередь модерации оператора: посты с жалобами, сначала скрытые."""
        if not await self._is_operator(operator_id):
            return None
        rows = await self.db.fetchall(
            "SELECT p.*, COUNT(r.user_id) AS reports FROM posts p JOIN post_reports r ON r.post_id = p.id"
            " GROUP BY p.id ORDER BY p.hidden DESC, reports DESC, p.id DESC")
        return [{**await self._post_view(r, operator_id), "reports": r["reports"]} for r in rows]

    async def moderate(self, operator_id: int, post_id: int, keep: bool) -> bool:
        """Оператор: оставить (жалобы снимаются, пост виден) или удалить."""
        if not await self._is_operator(operator_id):
            return False
        if not keep:
            return await self.delete_post(operator_id, post_id)
        await self.db.execute("DELETE FROM post_reports WHERE post_id = ?", (post_id,))
        await self.db.execute("UPDATE posts SET hidden = 0 WHERE id = ?", (post_id,))
        return True

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
            # лимит на фото: еда, записанная вручную, его не тратит
            "SELECT COUNT(*) AS n FROM meals WHERE user_id = ? AND received_at >= ? AND received_at < ?"
            " AND status != 'manual'",
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
                " AND m.received_at >= ? AND m.received_at < ? AND m.status IN ('sent','confirmed','corrected','manual')"
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
        owner = await self.db.get_user(user_id)
        kk = owner is not None and owner["lang"] == "kk"
        for r in await self.db.meal_items(meal_id):
            dish = self.base.get(r["dish_id"])
            items.append({
                "dish_id": r["dish_id"], "raw_name": r["raw_name"],
                "name": (dish.name_kk if kk and dish.name_kk else dish.name_ru) if dish else r["raw_name"],
                "grams": r["grams"], "ai_grams": r["ai_grams"], "portion": r["portion"],
                "unit": dish.unit if dish else None,
                "unit_grams": dish.unit_grams if dish else None,
                "kcal": r["kcal"], "protein": r["protein"], "fat": r["fat"], "carbs": r["carbs"],
                "confidence": conf.get(r["raw_name"]), "in_base": dish is not None,
            })
        status = {"received": "draft", "draft": "draft", "sent": "reviewed", "confirmed": "reviewed",
                  "corrected": "reviewed", "failed": "not_food", "manual": "manual"}[meal["status"]]
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

    MANUAL_DAYS_BACK = 7  # вручную можно дописать еду не дальше недели назад

    async def manual_meal(self, user_id: int, items: list[tuple[str, float]], ts: int | None = None) -> int | None:
        """Еда без фото: человек сам выбрал блюда из базы. Проверка не нужна — в очередь специалиста не идёт
        и в серию фото не засчитывается. Возвращает id или None, если блюдо не из базы или дата вне недели."""
        now_ts = self.db.clock()
        ts = ts or now_ts
        if ts > now_ts + 60 or ts < local_day_bounds(now_ts, self.MANUAL_DAYS_BACK)[0]:
            return None
        new = []
        for dish_id, grams in items:
            dish = self.base.get(dish_id)
            if dish is None or not 0 < grams <= 3000:
                return None
            new.append(make_item(dish.name_ru, grams, self.base, self.matcher, dish_id=dish_id))
        meal_id = await self.db.execute(
            "INSERT INTO meals (user_id, received_at, status, reviewed_at) VALUES (?, ?, 'manual', NULL)", (user_id, ts))
        await self.db.replace_items(meal_id, new)
        await self.db.log_event("manual_meal", user_id, meal_id=meal_id, channel="app")
        return meal_id

    async def delete_meal(self, meal_id: int, user_id: int) -> bool:
        """Клиент удаляет свой приём пищи: строки и фото. Метрики (ai_requests, events) остаются без фото."""
        meal = await self.db.fetchone("SELECT * FROM meals WHERE id = ? AND user_id = ?", (meal_id, user_id))
        if meal is None:
            return False
        if meal["photo_path"]:
            Path(meal["photo_path"]).unlink(missing_ok=True)
        await self.db.execute("DELETE FROM meal_items WHERE meal_id = ?", (meal_id,))
        await self.db.execute("DELETE FROM meals WHERE id = ?", (meal_id,))
        await self.db.log_event("meal_deleted", user_id, meal_id=meal_id, status=meal["status"])
        return True

    # --- вес (приложение) ---
    async def add_weight(self, user_id: int, kg: float, ts: int | None = None) -> None:
        """Взвешивание. Одно на день: повторное в тот же день заменяет прежнее.
        Последний вес становится весом профиля — личная норма пересчитывается сама."""
        ts = ts or self.db.clock()
        start, end = local_day_bounds(ts)
        await self.db.execute("DELETE FROM weights WHERE user_id = ? AND ts >= ? AND ts < ?", (user_id, start, end))
        await self.db.execute("INSERT INTO weights (user_id, ts, kg) VALUES (?, ?, ?)", (user_id, ts, round(kg, 1)))
        last = await self.db.fetchone("SELECT kg FROM weights WHERE user_id = ? ORDER BY ts DESC LIMIT 1", (user_id,))
        await self.db.update_user(user_id, weight_kg=last["kg"])
        await self.db.log_event("weight", user_id, channel="app")

    async def weights_view(self, user_id: int, days: int = 90) -> dict:
        since = self.db.clock() - days * 86400
        rows = await self.db.fetchall(
            "SELECT ts, kg FROM weights WHERE user_id = ? AND ts >= ? ORDER BY ts", (user_id, since))
        points = [{"date": datetime.fromtimestamp(r["ts"], ALMATY).date().isoformat(), "kg": r["kg"]} for r in rows]
        first, last = (points[0]["kg"], points[-1]["kg"]) if points else (None, None)
        return {"points": points, "change": round(last - first, 1) if points else None}

    async def recent_dishes(self, user_id: int, limit: int = 8) -> list[str]:
        """Что человек ест чаще всего за последний месяц — для быстрого выбора без поиска."""
        rows = await self.db.fetchall(
            "SELECT i.dish_id, COUNT(*) AS n, MAX(m.received_at) AS last FROM meal_items i JOIN meals m ON m.id = i.meal_id"
            " WHERE m.user_id = ? AND m.received_at >= ? AND i.dish_id IS NOT NULL AND m.status != 'failed'"
            " GROUP BY i.dish_id ORDER BY n DESC, last DESC LIMIT ?",
            (user_id, self.db.clock() - 30 * 86400, limit))
        return [r["dish_id"] for r in rows if self.base.get(r["dish_id"])]

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
        from .advice import pick_options, targets_for
        kcal_target, protein_target = targets_for(user)
        # «Совет на вечер»: 1–3 блюда из базы под остаток дня. Считает Engine, не модель.
        remaining = kcal_target - tot["kcal"]
        protein_low = bool(meals) and tot["protein"] < protein_target * 0.7
        advice = []
        for d, grams in pick_options(self.base, remaining, protein_low):
            n = compute(d, grams)
            advice.append({"dish_id": d.id, "name": d.name(user["lang"]), "grams": grams,
                           "kcal": round(n.kcal), "protein": round(n.protein, 1)})
        hint = "protein" if protein_low else "light" if meals and remaining < 400 else None
        return {"meals": meals, "totals": {k: round(v, 1) for k, v in tot.items()},
                "targets": {"kcal": kcal_target, "protein": protein_target},
                "advice": {"remaining_kcal": round(remaining), "hint": hint, "options": advice}}

    # --- серия и неделя (приложение) ---
    STAGE_DAYS = (0, 3, 7, 14, 30)  # пороги стадий маскота, черновик — утверждает фаундер
    MIN_PHOTOS_PER_DAY = 2          # день засчитывается в серию при стольких фото еды

    @classmethod
    def stage_for(cls, days: int) -> int:
        return max(i + 1 for i, d in enumerate(cls.STAGE_DAYS) if days >= d)

    async def _photos_by_day(self, user_id: int) -> dict:
        from datetime import datetime
        rows = await self.db.fetchall(
            "SELECT received_at FROM meals WHERE user_id = ? AND status NOT IN ('failed', 'manual')", (user_id,))
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
        # Итог недели от специалиста главнее; без него — последний комментарий к разбору за неделю
        comment = await self.db.fetchone(
            "SELECT text AS comment FROM week_comments WHERE student_id = ? AND week_start = ?",
            (user_id, self.week_start(ts)))
        comment = comment or await self.db.fetchone(
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
    telegram_ready = False  # бот подключён и Telegram принял токен (ставит api.Notifier.start)
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
        from .advice import targets_for
        kcal, protein = targets_for(user)
        view = {"user_id": user_id, "role": user["role"], "goal": user["goal"], "lang": user["lang"],
                "coach": {"name": coach["name"], "code": coach["code"]} if coach else None,
                "profile": {k: user[k] for k in ("sex", "birth_year", "height_cm", "weight_kg", "activity")},
                "targets": {"kcal": kcal, "protein": protein, "set_by_pro": bool(user["kcal_target"])}}
        # Уведомления в Telegram (nutrivia/notify.py): available — бот подключён на сервере
        linked = await self.db.fetchone("SELECT 1 FROM tg_links WHERE user_id = ?", (user_id,))
        view["telegram"] = {"available": self.telegram_ready, "linked": bool(linked)}
        if user["role"] == "operator":
            n = await self.db.fetchone("SELECT COUNT(*) AS n FROM users WHERE channel = 'app' AND role = 'client'"
                                       " AND coach_code IS NULL")
            view["pro"] = {"name": "Команда Nutrivia", "invite_code": None, "students": n["n"], "limit": None,
                           "operator": True}
        code = await self.pro_code(user_id)
        if code:
            pro = await self.db.get_coach(code)
            n = await self.db.fetchone("SELECT COUNT(*) AS n FROM users WHERE coach_code = ?", (code,))
            view["pro"] = {"name": pro["name"], "invite_code": code, "students": n["n"],
                           "limit": self.STUDENT_LIMIT.get(user["role"])}
        return view

    async def students_view(self, pro_user_id: int) -> list[dict] | None:
        """Ученики специалиста: калории за сегодня и сколько разборов ждут проверки."""
        scope = await self._scope(pro_user_id)
        if scope is None:
            return None
        start, end = local_day_bounds()
        out = []
        for u in await self.db.fetchall(f"SELECT * FROM users WHERE {scope[0]} ORDER BY joined_at, tg_id", scope[1]):
            totals = await self.db.fetchone(
                "SELECT COUNT(DISTINCT m.id) AS meals, COALESCE(SUM(i.kcal),0) AS kcal FROM meals m"
                " LEFT JOIN meal_items i ON i.meal_id = m.id WHERE m.user_id = ? AND m.received_at >= ?"
                " AND m.received_at < ? AND m.status != 'failed'", (u["tg_id"], start, end))
            drafts = await self.db.fetchone(
                "SELECT COUNT(*) AS n FROM meals WHERE user_id = ? AND status = 'draft'", (u["tg_id"],))
            from .advice import targets_for
            kcal_target, _ = targets_for(u)
            streak = await self.streak_view(u["tg_id"])
            out.append({"user_id": u["tg_id"], "label": f"{scope[2]} {len(out) + 1}", "goal": u["goal"],
                        "meals_today": totals["meals"], "kcal_today": round(totals["kcal"]),
                        "kcal_target": kcal_target, "pending_reviews": drafts["n"], "streak_days": streak["days"]})
        return out

    # --- проверка разборов специалистом в приложении ---

    OPERATOR_AFTER = 15 * 60  # разбор без проверки дольше 15 минут видит и оператор — так обещано клиенту

    async def _scope(self, pro_user_id: int) -> tuple[str, tuple, str] | None:
        """Чьих клиентов видит проверяющий: (условие на users, параметры, подпись).
        Специалист — своих учеников. Оператор Nutrivia — клиентов приложения без тренера
        (разборы учеников с тренером он тоже видит, если те ждут дольше OPERATOR_AFTER)."""
        code = await self.pro_code(pro_user_id)
        if code is not None:
            return "coach_code = ?", (code,), "Ученик"
        user = await self.db.get_user(pro_user_id)
        if user and user["role"] == "operator":
            return "channel = 'app' AND role = 'client' AND coach_code IS NULL", (), "Клиент"
        return None

    @staticmethod
    def week_start(ts: int) -> str:
        """Понедельник недели по Алматы — ключ итога недели."""
        from datetime import timedelta
        d = datetime.fromtimestamp(ts, ALMATY).date()
        return (d - timedelta(days=d.weekday())).isoformat()

    async def pro_student(self, pro_user_id: int, student_id: int):
        """Ученик (клиент), которого видит этот проверяющий, или None."""
        scope = await self._scope(pro_user_id)
        if scope is None:
            return None
        cond, args, _ = scope
        return await self.db.fetchone(f"SELECT * FROM users WHERE tg_id = ? AND {cond}", (student_id, *args))

    async def student_card(self, pro_user_id: int, student_id: int) -> dict | None:
        """Всё про ученика для специалиста: параметры, норма, неделя, серия, вес, приёмы пищи за 14 дней, заметка."""
        u = await self.pro_student(pro_user_id, student_id)
        if u is None:
            return None
        from .advice import targets_for
        kcal, protein = targets_for(u)
        labels = await self.student_labels(pro_user_id)
        rows = await self.db.fetchall(
            "SELECT id FROM meals WHERE user_id = ? AND received_at >= ? AND status != 'failed' ORDER BY received_at DESC",
            (student_id, self.db.clock() - 14 * 86400))
        note = await self.db.fetchone("SELECT text FROM pro_notes WHERE student_id = ? AND pro_id = ?",
                                      (student_id, pro_user_id))
        return {
            "user_id": student_id, "label": labels.get(student_id, "Ученик"), "goal": u["goal"],
            "profile": {k: u[k] for k in ("sex", "birth_year", "height_cm", "weight_kg", "activity")},
            "targets": {"kcal": kcal, "protein": protein, "set_by_pro": bool(u["kcal_target"])},
            "week": await self.week_view(student_id), "streak": await self.streak_view(student_id),
            "weights": await self.weights_view(student_id),
            "meals": [await self.meal_view(r["id"], student_id) for r in rows],
            "note": note["text"] if note else "",
        }

    async def set_week_comment(self, pro_user_id: int, student_id: int, text: str) -> bool:
        if await self.pro_student(pro_user_id, student_id) is None:
            return False
        ts = self.db.clock()
        text = text.strip()[:2000]
        if not text:
            await self.db.execute("DELETE FROM week_comments WHERE student_id = ? AND week_start = ?",
                                  (student_id, self.week_start(ts)))
        else:
            await self.db.execute(
                "INSERT OR REPLACE INTO week_comments (student_id, week_start, pro_id, text, ts) VALUES (?, ?, ?, ?, ?)",
                (student_id, self.week_start(ts), pro_user_id, text, ts))
        await self.db.log_event("week_comment", student_id, reviewer=pro_user_id)
        return True

    async def set_student_target(self, pro_user_id: int, student_id: int, kcal: int | None) -> bool:
        """Ориентир калорий от специалиста (как /target в Telegram). None — вернуть личный расчёт."""
        if await self.pro_student(pro_user_id, student_id) is None:
            return False
        await self.db.update_user(student_id, kcal_target=kcal)
        await self.db.log_event("target_set", student_id, reviewer=pro_user_id, kcal=kcal)
        return True

    async def set_note(self, pro_user_id: int, student_id: int, text: str) -> bool:
        """Заметка специалиста об ученике — видит только он сам."""
        if await self.pro_student(pro_user_id, student_id) is None:
            return False
        await self.db.execute("INSERT OR REPLACE INTO pro_notes (student_id, pro_id, text, ts) VALUES (?, ?, ?, ?)",
                              (student_id, pro_user_id, text.strip()[:4000], self.db.clock()))
        return True

    async def make_operator(self, auth, raw_phone: str) -> tuple[str, str]:
        """Номер → оператор Nutrivia. Нет аккаунта — создаём. Возвращает (номер, статус): ok | has_coach."""
        from .auth import normalize_phone
        phone = normalize_phone(raw_phone)
        uid = await auth.user_for_phone(phone)
        if uid is None:
            uid = (await self.create_app_user("client", "ru", None, None))["tg_id"]
            await auth.link(phone, uid)
        user = await self.db.get_user(uid)
        if user["coach_code"] or await self.pro_code(uid):
            return phone, "has_coach"
        await self.db.update_user(uid, role="operator")
        await self.db.log_event("operator_set", uid)
        return phone, "ok"

    async def admin_overview(self) -> dict:
        """Пилот одним взглядом: кто есть, сколько фото по дням, удержание, очередь, расходы на ИИ."""
        from datetime import timedelta
        from .metrics import compute_metrics
        now_ts = self.db.clock()
        roles = {r["role"]: r["n"] for r in await self.db.fetchall(
            "SELECT role, COUNT(*) AS n FROM users WHERE channel = 'app' GROUP BY role")}
        days = []
        for back in range(13, -1, -1):
            start, end = local_day_bounds(now_ts, back)
            row = await self.db.fetchone(
                "SELECT COUNT(*) AS photos, COUNT(DISTINCT user_id) AS users FROM meals"
                " WHERE received_at >= ? AND received_at < ? AND photo_path IS NOT NULL", (start, end))
            days.append({"date": datetime.fromtimestamp(start, ALMATY).date().isoformat(), **dict(row)})
        # удержание: из пришедших не позже чем N дней назад — кто прислал что-то на N-й день и позже
        def retained(n: int):
            return self.db.fetchone(
                "SELECT COUNT(*) AS cohort, SUM(EXISTS(SELECT 1 FROM meals m WHERE m.user_id = u.tg_id"
                " AND m.received_at >= u.joined_at + ? * 86400)) AS kept FROM users u"
                " WHERE u.channel = 'app' AND u.role = 'client' AND u.joined_at <= ?", (n, now_ts - n * 86400))
        d1, d7 = await retained(1), await retained(7)
        pending = await self.db.fetchone(
            "SELECT COUNT(*) AS n, MIN(received_at) AS oldest FROM meals WHERE status = 'draft'")
        metrics = await compute_metrics(self.db)
        m = metrics["summary"]
        return {
            "roles": roles, "photos_by_day": days,
            "retention": {"d1": dict(d1), "d7": dict(d7)},
            "queue": {"pending": pending["n"],
                      "oldest_wait_min": round((now_ts - pending["oldest"]) / 60) if pending["oldest"] else None},
            "review_median_s": m["median_review_seconds"], "gram_error_median": m["gram_error_median"],
            "ai": {"requests": m["ai_requests"], "failed": m["ai_failed"], "cost_usd": m["ai_cost_usd"]},
            "missing_dishes": metrics["missing_dishes"][:15],
        }

    async def admin_users(self, phones: dict[int, str]) -> list[dict]:
        """Все пользователи приложения: роль, тренер, активность за неделю. Номер — с маской."""
        week = self.db.clock() - 7 * 86400
        out = []
        for u in await self.db.fetchall("SELECT * FROM users WHERE channel = 'app' ORDER BY joined_at DESC"):
            coach = await self.db.get_coach(u["coach_code"])
            act = await self.db.fetchone(
                "SELECT COUNT(*) AS meals7, MAX(received_at) AS last, SUM(status = 'draft') AS pending"
                " FROM meals WHERE user_id = ? AND received_at >= ?", (u["tg_id"], week))
            phone = phones.get(u["tg_id"], "")
            out.append({
                "user_id": u["tg_id"], "role": u["role"], "phone": phone[:4] + " *** ** " + phone[-4:-2] + " " + phone[-2:] if phone else "",
                "coach": coach["name"] if coach else None, "pro_code": await self.pro_code(u["tg_id"]),
                "joined": datetime.fromtimestamp(u["joined_at"], ALMATY).date().isoformat(),
                "meals_7d": act["meals7"], "pending": act["pending"] or 0,
                "last": datetime.fromtimestamp(act["last"], ALMATY).strftime("%d.%m %H:%M") if act["last"] else None,
            })
        return out

    async def is_reviewer(self, user_id: int) -> bool:
        return await self._scope(user_id) is not None

    async def student_labels(self, pro_user_id: int) -> dict[int, str]:
        """«Ученик N» / «Клиент N» по порядку подключения — те же номера, что в списке."""
        cond, args, word = await self._scope(pro_user_id)
        rows = await self.db.fetchall(f"SELECT tg_id FROM users WHERE {cond} ORDER BY joined_at, tg_id", args)
        return {r["tg_id"]: f"{word} {i + 1}" for i, r in enumerate(rows)}

    async def _operator_late(self) -> int:
        return self.db.clock() - self.OPERATOR_AFTER

    async def pro_meal(self, pro_user_id: int, meal_id: int):
        """Приём пищи, который этот проверяющий может видеть, или None (чужие разборы не видны)."""
        scope = await self._scope(pro_user_id)
        if scope is None:
            return None
        cond, args, word = scope
        if word == "Клиент":  # оператор: свои клиенты или просроченный черновик любого клиента приложения
            return await self.db.fetchone(
                "SELECT m.* FROM meals m JOIN users u ON u.tg_id = m.user_id WHERE m.id = ? AND u.channel = 'app'"
                " AND u.role = 'client' AND (u.coach_code IS NULL OR (m.status = 'draft' AND m.received_at < ?))",
                (meal_id, await self._operator_late()))
        return await self.db.fetchone(
            f"SELECT m.* FROM meals m JOIN users u ON u.tg_id = m.user_id WHERE m.id = ? AND u.{cond}",
            (meal_id, *args))

    async def pro_queue(self, pro_user_id: int) -> list[dict] | None:
        """Черновики учеников, старые сверху: их и надо проверить первыми (обещание — 15 минут)."""
        scope = await self._scope(pro_user_id)
        if scope is None:
            return None
        cond, args, word = scope
        labels = await self.student_labels(pro_user_id)
        if word == "Клиент":
            rows = await self.db.fetchall(
                "SELECT m.id, m.user_id FROM meals m JOIN users u ON u.tg_id = m.user_id"
                " WHERE m.status = 'draft' AND u.channel = 'app' AND u.role = 'client'"
                " AND (u.coach_code IS NULL OR m.received_at < ?) ORDER BY m.received_at",
                (await self._operator_late(),))
        else:
            rows = await self.db.fetchall(
                f"SELECT m.id, m.user_id FROM meals m JOIN users u ON u.tg_id = m.user_id"
                f" WHERE u.{cond} AND m.status = 'draft' ORDER BY m.received_at", args)
        out = []
        for r in rows:
            view = await self.meal_view(r["id"], r["user_id"])
            out.append({**view, "student": labels.get(r["user_id"], "Ученик тренера"), "student_id": r["user_id"]})
        return out

    async def pro_meal_view(self, pro_user_id: int, meal_id: int) -> dict | None:
        meal = await self.pro_meal(pro_user_id, meal_id)
        if meal is None:
            return None
        labels = await self.student_labels(pro_user_id)
        student = await self.db.get_user(meal["user_id"])
        view = await self.meal_view(meal_id, meal["user_id"])
        return {**view, "student": labels.get(meal["user_id"], "Ученик тренера"), "student_id": meal["user_id"],
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

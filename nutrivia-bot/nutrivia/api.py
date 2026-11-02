"""HTTP API для мобильного приложения поверх того же Service, что у бота.

Фото уходит сюда, ключ AI живёт только на сервере, разбор делает VisionProvider (claude-opus-5-5),
нутриенты считает Engine. Черновик сразу виден клиенту с пометкой «оценка по фото» и параллельно
уходит карточкой в группу проверки в Telegram (если задан BOT_TOKEN).

Вход — по номеру телефона и коду из SMS (nutrivia/auth.py), дальше заголовок Authorization: Bearer <токен>.
При регистрации выбирается тип аккаунта: для себя, тренер, нутрициолог.
"""
import logging
import os
import secrets
from pathlib import Path
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Annotated, Literal

from fastapi import BackgroundTasks, Depends, FastAPI, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from rapidfuzz import fuzz, process

from .auth import AuthError, ConsoleSms, ManualCodes, MobizonSms, SmsAuth, SmsProvider
from .config import ALMATY, Config, load_config
from .db import Database
from .engine import DishBase
from .matcher import normalize
from .ratelimit import RateLimiter
from .service import Service
from .vision import VisionProvider, make_vision

log = logging.getLogger(__name__)
MAX_PHOTO_BYTES = 8 * 1024 * 1024


def sniff_image(data: bytes) -> str | None:
    """Тип по первым байтам, а не по заголовку клиента. Только форматы, которые принимает модель."""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


class Notifier:
    """Карточки в группу проверки через Telegram-бота. Без BOT_TOKEN — тихо ничего не делает."""

    def __init__(self, cfg: Config, svc: Service):
        self.svc = svc
        self.bot = None
        if cfg.bot_token:
            from aiogram import Bot
            self.bot = Bot(cfg.bot_token)

    async def review_card(self, chat_id: int, meal_id: int, image: bytes, text: str) -> None:
        if self.bot is None:
            return
        from .bot import send_review_card
        try:
            await send_review_card(self.bot, self.svc, chat_id, meal_id, image, text)
        except Exception:
            log.exception("review card for meal %s failed", meal_id)

    async def close(self) -> None:
        if self.bot is not None:
            await self.bot.session.close()


def make_sms() -> SmsProvider:
    """SMS_PROVIDER: mobizon (MOBIZON_API_KEY, необязательно SMS_FROM) | manual — коды выдаёт админ (пилот)
    | console — код в лог сервера (разработка)."""
    provider = os.environ.get("SMS_PROVIDER", "console")
    if provider == "console":
        return ConsoleSms()
    if provider == "manual":
        return ManualCodes()
    if provider == "mobizon":
        key = os.environ.get("MOBIZON_API_KEY", "")
        if not key:
            raise RuntimeError("SMS_PROVIDER=mobizon, но нет MOBIZON_API_KEY")
        return MobizonSms(key, os.environ.get("SMS_FROM", ""))
    raise RuntimeError(f"SMS_PROVIDER={provider} ещё не подключён")


PWA_HEAD = (
    '<link rel="manifest" href="/manifest.webmanifest">'
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">'
    '<meta name="theme-color" content="#6B4EFF">'
    '<meta name="apple-mobile-web-app-capable" content="yes">'
    '<meta name="apple-mobile-web-app-title" content="Nutrivia">'
    '<meta name="apple-mobile-web-app-status-bar-style" content="default">'
)


def create_app(cfg: Config | None = None, vision: VisionProvider | None = None, db_path: str | None = None,
               sms: SmsProvider | None = None) -> FastAPI:
    cfg = cfg or load_config()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        db = Database(db_path or cfg.db_path)
        await db.connect()
        v = vision or make_vision(cfg.vision_provider, cfg.vision_model, cfg.openrouter_api_key, cfg.vision_fallback_model)
        svc = Service(db, DishBase.from_csv(cfg.dishes_csv), v, cfg)
        secret = os.environ.get("AUTH_SECRET")
        if not secret:
            log.warning("AUTH_SECRET не задан — коды из SMS будут недействительны после перезапуска сервера")
            secret = secrets.token_hex(32)
        auth = SmsAuth(db, sms or make_sms(), secret)
        await auth.init()
        app.state.svc = svc
        app.state.auth = auth
        app.state.notifier = Notifier(cfg, svc)
        yield
        await app.state.notifier.close()
        await db.close()

    app = FastAPI(title="Nutrivia API", version="0.3.0", lifespan=lifespan)
    limiter = RateLimiter()

    @app.middleware("http")
    async def guard(request: Request, call_next):
        """Частота запросов + заголовки безопасности на каждый ответ."""
        auth = request.headers.get("authorization", "")
        ip = request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "?")
        wait = limiter.check(request.url.path, request.method, ip, auth[7:] if auth.startswith("Bearer ") else None)
        if wait is not None:
            resp = JSONResponse({"code": "too_many", "message": "Слишком много запросов. Попробуйте чуть позже.",
                                 "retry_after": wait}, status_code=429, headers={"Retry-After": str(wait)})
        else:
            resp = await call_next(request)
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("Referrer-Policy", "no-referrer")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Permissions-Policy", "camera=(self), geolocation=(), microphone=()")
        return resp

    @app.exception_handler(AuthError)
    async def auth_error(_: Request, e: AuthError):
        headers = {"Retry-After": str(e.retry_after)} if e.retry_after else None
        return JSONResponse({"code": e.code, "message": e.message, "retry_after": e.retry_after},
                            status_code=e.status, headers=headers)

    def svc_dep() -> Service:
        return app.state.svc

    Svc = Annotated[Service, Depends(svc_dep)]

    async def session_dep(authorization: Annotated[str | None, Header()] = None):
        token = (authorization or "").removeprefix("Bearer ").strip()
        session = await app.state.auth.session(token) if token else None
        if session is None:
            raise HTTPException(401, "login required")
        return session

    async def user_dep(svc: Svc, session=Depends(session_dep)):
        user = await svc.db.get_user(session.user_id)
        if user is None:
            raise HTTPException(401, "login required")
        return user

    User = Annotated[dict, Depends(user_dep)]

    class StartIn(BaseModel):
        phone: str = Field(max_length=32)

    class VerifyIn(BaseModel):
        phone: str = Field(max_length=32)
        code: str = Field(min_length=4, max_length=4, pattern=r"^\d{4}$")
        # для нового номера — данные регистрации; для существующего игнорируются
        consent: bool = False
        role: Literal["client", "trainer", "nutritionist"] = "client"
        lang: Literal["ru", "kk"] = "ru"
        goal: Literal["lose", "muscle", "even", "coach_plan"] | None = None
        name: str | None = Field(default=None, max_length=60)
        invite_code: str | None = Field(default=None, max_length=16)

    class MePatch(BaseModel):
        """Цель и параметры для личной нормы; передаются только меняемые поля."""
        goal: Literal["lose", "muscle", "even", "coach_plan"] | None = None
        sex: Literal["f", "m"] | None = None
        birth_year: int | None = Field(default=None, ge=1920, le=2100)
        height_cm: float | None = Field(default=None, ge=120, le=230)
        weight_kg: float | None = Field(default=None, ge=35, le=300)
        activity: Literal["low", "light", "mid", "high"] | None = None

    class JoinIn(BaseModel):
        invite_code: str = Field(min_length=4, max_length=16)

    class ItemIn(BaseModel):
        dish_id: str = Field(max_length=64)
        grams: float = Field(gt=0, le=3000)

    class ItemsIn(BaseModel):
        items: list[ItemIn] = Field(min_length=1, max_length=20)

    class ManualIn(ItemsIn):
        # День из полосы дней: дописать еду в прошлое (не дальше недели); без него — сейчас
        date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")

    @app.get("/health")
    async def health():
        return {"ok": True}

    JOIN_MESSAGES = {
        "not_found": "Такого кода нет. Проверьте его у тренера или нутрициолога.",
        "full": "У этого тренера уже максимум учеников.",
        "not_client": "Код вводят только клиенты.",
    }

    @app.post("/v1/auth/sms/start")
    async def sms_start(body: StartIn):
        return await app.state.auth.start(body.phone)

    @app.post("/v1/auth/sms/verify")
    async def sms_verify(body: VerifyIn, svc: Svc):
        auth: SmsAuth = app.state.auth
        phone = await auth.verify(body.phone, body.code)
        uid = await auth.user_for_phone(phone)
        is_new = uid is None
        join = None
        if is_new:
            if not body.consent:
                raise AuthError("consent_required", "Нужно согласие на обработку данных.", 409)
            if body.role != "client" and not (body.name or "").strip():
                raise AuthError("name_required", "Укажите имя — его увидят ваши ученики.", 400)
            user = await svc.create_app_user(body.role, body.lang, body.goal, body.name)
            uid = user["tg_id"]
            await auth.link(phone, uid)
            # Пилот без Telegram: клиент без кода попадает к специалисту по умолчанию (DEFAULT_INVITE_CODE)
            code = body.invite_code or os.environ.get("DEFAULT_INVITE_CODE", "")
            if code and body.role == "client":
                join = await svc.join_coach(uid, code)
                if not body.invite_code and join != "ok":
                    log.warning("DEFAULT_INVITE_CODE %s: %s", code, join)
                    join = None
        token = await auth.issue(uid)
        return {"token": token, "is_new": is_new, "join": join, "join_message": JOIN_MESSAGES.get(join),
                "me": await svc.me_view(uid)}

    @app.post("/v1/auth/logout", status_code=204)
    async def logout(session=Depends(session_dep)):
        await app.state.auth.revoke(session.token_hash)

    @app.get("/v1/me")
    async def me(svc: Svc, user: User):
        return await svc.me_view(user["tg_id"])

    @app.patch("/v1/me")
    async def patch_me(body: MePatch, svc: Svc, user: User):
        fields = body.model_dump(exclude_none=True)
        if "birth_year" in fields:
            year = datetime.fromtimestamp(svc.db.clock(), ALMATY).year
            if year - fields["birth_year"] < 18:
                raise AuthError("under_18", "Nutrivia — только для взрослых, от 18 лет.", 400)
        if fields:
            await svc.db.update_user(user["tg_id"], **fields)
        return await svc.me_view(user["tg_id"])

    @app.post("/v1/me/coach")
    async def join(body: JoinIn, svc: Svc, user: User):
        status = await svc.join_coach(user["tg_id"], body.invite_code)
        if status != "ok":
            raise AuthError(status, JOIN_MESSAGES[status], 409 if status == "full" else 400)
        return await svc.me_view(user["tg_id"])

    @app.get("/v1/pro/students")
    async def students(svc: Svc, user: User):
        """Для тренера и нутрициолога: ученики, их калории за сегодня и непроверенные разборы."""
        view = await svc.students_view(user["tg_id"])
        if view is None:
            raise HTTPException(403, "pro only")
        return {"students": view, "me": await svc.me_view(user["tg_id"])}

    # --- проверка разборов специалистом ---

    class CommentIn(BaseModel):
        text: str = Field(min_length=1, max_length=1000)

    SEND_ERRORS = {
        "not_found": (404, "Разбор не найден."),
        "already_sent": (409, "Этот разбор уже отправлен — возможно, его проверил оператор."),
        "unmatched": (409, "Есть блюдо не из базы. Замените его блюдом из базы или уберите."),
        "empty": (409, "В разборе нет блюд."),
    }

    async def pro_dep(svc: Svc, user: User):
        if not await svc.is_reviewer(user["tg_id"]):
            raise HTTPException(403, "pro only")
        return user

    Pro = Annotated[dict, Depends(pro_dep)]

    class TextIn(BaseModel):
        text: str = Field(max_length=4000)

    class TargetIn(BaseModel):
        kcal: int | None = Field(default=None, ge=1000, le=5000)

    @app.get("/v1/pro/students/{student_id}")
    async def student_card(student_id: int, svc: Svc, pro: Pro):
        card = await svc.student_card(pro["tg_id"], student_id)
        if card is None:
            raise HTTPException(404)
        return card

    @app.post("/v1/pro/students/{student_id}/week-comment")
    async def week_comment(student_id: int, body: TextIn, svc: Svc, pro: Pro):
        if not await svc.set_week_comment(pro["tg_id"], student_id, body.text):
            raise HTTPException(404)
        return await svc.student_card(pro["tg_id"], student_id)

    @app.put("/v1/pro/students/{student_id}/target")
    async def student_target(student_id: int, body: TargetIn, svc: Svc, pro: Pro):
        if not await svc.set_student_target(pro["tg_id"], student_id, body.kcal):
            raise HTTPException(404)
        return await svc.student_card(pro["tg_id"], student_id)

    @app.put("/v1/pro/students/{student_id}/note")
    async def student_note(student_id: int, body: TextIn, svc: Svc, pro: Pro):
        if not await svc.set_note(pro["tg_id"], student_id, body.text):
            raise HTTPException(404)
        return {"ok": True}

    @app.get("/v1/pro/queue")
    async def pro_queue(svc: Svc, pro: Pro):
        return {"meals": await svc.pro_queue(pro["tg_id"])}

    @app.get("/v1/pro/meals/{meal_id}")
    async def pro_meal(meal_id: int, svc: Svc, pro: Pro):
        view = await svc.pro_meal_view(pro["tg_id"], meal_id)
        if view is None:
            raise HTTPException(404)
        return view

    @app.get("/v1/pro/meals/{meal_id}/photo")
    async def pro_meal_photo(meal_id: int, svc: Svc, pro: Pro):
        meal = await svc.pro_meal(pro["tg_id"], meal_id)
        if meal is None or not meal["photo_path"] or not Path(meal["photo_path"]).is_file():
            raise HTTPException(404)
        head = Path(meal["photo_path"]).read_bytes()[:12]
        return FileResponse(meal["photo_path"], media_type=sniff_image(head) or "application/octet-stream",
                            headers={"Cache-Control": "private, max-age=86400"})

    @app.put("/v1/pro/meals/{meal_id}/items")
    async def pro_items(meal_id: int, body: ItemsIn, svc: Svc, pro: Pro):
        if not await svc.pro_set_items(pro["tg_id"], meal_id, [(i.dish_id, i.grams) for i in body.items]):
            raise HTTPException(409, "already sent or unknown dish")
        return await svc.pro_meal_view(pro["tg_id"], meal_id)

    @app.post("/v1/pro/meals/{meal_id}/comment")
    async def pro_comment(meal_id: int, body: CommentIn, svc: Svc, pro: Pro):
        if not await svc.pro_comment(pro["tg_id"], meal_id, body.text):
            raise HTTPException(409, "already sent")
        return await svc.pro_meal_view(pro["tg_id"], meal_id)

    @app.post("/v1/pro/meals/{meal_id}/send")
    async def pro_send(meal_id: int, svc: Svc, pro: Pro):
        status = await svc.pro_send(pro["tg_id"], meal_id)
        if status != "ok":
            code, message = SEND_ERRORS[status]
            raise AuthError(status, message, code)
        return await svc.pro_meal_view(pro["tg_id"], meal_id)

    @app.get("/v1/users/me/export")
    async def export_me(svc: Svc, user: User):
        """Все мои данные одним файлом: профиль, приёмы пищи с блюдами, вес. Фото — по ссылкам /v1/meals/{id}/photo."""
        from fastapi.responses import Response
        import json as _json
        data = await svc.export_user(user["tg_id"])
        return Response(_json.dumps(data, ensure_ascii=False, indent=2), media_type="application/json",
                        headers={"Content-Disposition": "attachment; filename=nutrivia-my-data.json"})

    @app.delete("/v1/users/me", status_code=204)
    async def delete_me(svc: Svc, user: User):
        await app.state.auth.forget_user(user["tg_id"])
        await svc.delete_user(user["tg_id"])

    @app.post("/v1/meals")
    async def upload_meal(svc: Svc, user: User, background: BackgroundTasks, photo: UploadFile = File(...)):
        data = await photo.read(MAX_PHOTO_BYTES + 1)
        if len(data) > MAX_PHOTO_BYTES:
            raise HTTPException(413, "photo too large")
        media_type = sniff_image(data)
        if media_type is None:
            raise HTTPException(415, "jpeg, png or webp only")
        out = await svc.receive_photo(user["tg_id"], data, media_type)
        if out.status == "limit":
            raise HTTPException(429, "daily photo limit")
        if out.status == "not_food":
            return {"id": out.meal_id, "status": "not_food", "items": []}
        if out.status != "draft":
            raise HTTPException(403, out.status)
        background.add_task(app.state.notifier.review_card, out.review_chat_id, out.meal_id, data, out.review_text)
        view = await svc.meal_view(out.meal_id, user["tg_id"])
        return {**view, "night": out.night}

    @app.post("/v1/fridge")
    async def fridge(svc: Svc, user: User, photo: UploadFile = File(...)):
        """Фото холодильника → продукты и блюда из базы под остаток калорий дня. Фото не храним."""
        data = await photo.read(MAX_PHOTO_BYTES + 1)
        if len(data) > MAX_PHOTO_BYTES:
            raise HTTPException(413, "photo too large")
        media_type = sniff_image(data)
        if media_type is None:
            raise HTTPException(415, "jpeg, png or webp only")
        out = await svc.fridge(user["tg_id"], data, media_type)
        if out["status"] == "budget":
            raise AuthError("budget", "Разбор фото на сегодня приостановлен. Попробуйте завтра.", 429)
        if out["status"] == "error":
            raise AuthError("vision_error", "Не получилось разобрать фото. Попробуйте ещё раз.", 502)
        return out

    class ProductsIn(BaseModel):
        products: list[Annotated[str, Field(max_length=40)]] = Field(max_length=40)

    @app.post("/v1/fridge/ideas")
    async def fridge_ideas(body: ProductsIn, svc: Svc, user: User):
        return await svc.fridge_ideas(user["tg_id"], [p.strip().lower() for p in body.products if p.strip()])

    @app.get("/v1/meals/{meal_id}")
    async def get_meal(meal_id: int, svc: Svc, user: User):
        view = await svc.meal_view(meal_id, user["tg_id"])
        if view is None:
            raise HTTPException(404)
        return view

    @app.get("/v1/meals/{meal_id}/photo")
    async def meal_photo(meal_id: int, svc: Svc, user: User):
        """Фото только владельцу. Путь берём из базы, не из запроса."""
        row = await svc.db.fetchone("SELECT photo_path FROM meals WHERE id = ? AND user_id = ?", (meal_id, user["tg_id"]))
        if row is None or not row["photo_path"] or not Path(row["photo_path"]).is_file():
            raise HTTPException(404)
        data = Path(row["photo_path"]).read_bytes()[:12]
        return FileResponse(row["photo_path"], media_type=sniff_image(data) or "application/octet-stream",
                            headers={"Cache-Control": "private, max-age=86400"})

    @app.put("/v1/meals/{meal_id}/items")
    async def put_items(meal_id: int, body: ItemsIn, svc: Svc, user: User):
        ok = await svc.set_items(meal_id, user["tg_id"], [(i.dish_id, i.grams) for i in body.items])
        if not ok:
            raise HTTPException(422, "unknown meal or dish")
        return await svc.meal_view(meal_id, user["tg_id"])

    @app.post("/v1/meals/{meal_id}/confirm")
    async def confirm(meal_id: int, svc: Svc, user: User):
        if not await svc.app_confirm(meal_id, user["tg_id"]):
            raise HTTPException(404)
        return await svc.meal_view(meal_id, user["tg_id"])

    def day_ts(date: str | None, svc: Service) -> int | None:
        """«2026-11-01» → полдень этого дня по Алматы (для выборки дня); None — сегодня."""
        if not date:
            return None
        try:
            d = datetime.strptime(date, "%Y-%m-%d").replace(hour=12, tzinfo=ALMATY)
        except ValueError:
            raise HTTPException(422, "date: YYYY-MM-DD")
        ts = int(d.timestamp())
        if ts > svc.db.clock() + 86400:
            raise HTTPException(422, "date in the future")
        return ts

    @app.get("/v1/today")
    async def today(svc: Svc, user: User, date: str | None = None):
        return await svc.today_view(user["tg_id"], day_ts(date, svc))

    @app.post("/v1/meals/manual")
    async def manual_meal(body: ManualIn, svc: Svc, user: User):
        ts = day_ts(body.date, svc)
        if ts is not None and ts > svc.db.clock():
            ts = svc.db.clock()  # сегодняшний день — текущее время, а не полдень
        meal_id = await svc.manual_meal(user["tg_id"], [(i.dish_id, i.grams) for i in body.items], ts)
        if meal_id is None:
            raise HTTPException(422, "unknown dish or date out of range")
        return await svc.meal_view(meal_id, user["tg_id"])

    @app.delete("/v1/meals/{meal_id}", status_code=204)
    async def delete_meal(meal_id: int, svc: Svc, user: User):
        if not await svc.delete_meal(meal_id, user["tg_id"]):
            raise HTTPException(404)

    @app.get("/v1/progress")
    async def progress(svc: Svc, user: User):
        """Серия дней, стадия маскота и неделя для экранов «Серия» и «Прогресс»."""
        return {"streak": await svc.streak_view(user["tg_id"]), "week": await svc.week_view(user["tg_id"])}

    class WeightIn(BaseModel):
        kg: float = Field(ge=35, le=300)
        date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")

    @app.post("/v1/weights")
    async def add_weight(body: WeightIn, svc: Svc, user: User):
        ts = day_ts(body.date, svc)
        await svc.add_weight(user["tg_id"], body.kg, min(ts, svc.db.clock()) if ts else None)
        return {"weights": await svc.weights_view(user["tg_id"]), "me": await svc.me_view(user["tg_id"])}

    @app.get("/v1/weights")
    async def weights(svc: Svc, user: User):
        return await svc.weights_view(user["tg_id"])

    def dish_hit(d):
        return {"id": d.id, "name": d.name_ru, "unit": d.unit, "unit_grams": d.unit_grams, "kcal_100g": d.kcal}

    @app.get("/v1/dishes/recent")
    async def recent_dishes(svc: Svc, user: User):
        return [dish_hit(svc.base.get(i)) for i in await svc.recent_dishes(user["tg_id"])]

    @app.get("/v1/dishes")
    async def dishes(svc: Svc, q: Annotated[str, Query(max_length=64)] = ""):
        """Поиск блюда для «Добавить блюдо»: та же база, что у Engine."""
        all_dishes = list(svc.base)
        if not q.strip():
            hits = all_dishes[:20]
        else:
            names = {d.id: " ".join([d.name_ru, d.name_kk, *d.synonyms]) for d in all_dishes}
            found = process.extract(normalize(q), {k: normalize(v) for k, v in names.items()},
                                    scorer=fuzz.WRatio, limit=10, score_cutoff=60)
            hits = [svc.base.get(k) for _, _, k in found]
        return [dish_hit(d) for d in hits]

    # --- админка (ADMIN_TOKEN в .env; без него выключена) ---
    async def admin_dep(x_admin_token: Annotated[str | None, Header()] = None):
        expected = os.environ.get("ADMIN_TOKEN", "")
        if not expected:
            raise HTTPException(404)
        if not x_admin_token or not secrets.compare_digest(x_admin_token, expected):
            raise HTTPException(401, "admin token")

    Admin = Depends(admin_dep)

    class PhoneIn(BaseModel):
        phone: str = Field(max_length=32)

    async def phones_by_user() -> dict[int, str]:
        rows = await app.state.svc.db.fetchall("SELECT phone, user_id FROM app_accounts")
        return {r["user_id"]: r["phone"] for r in rows}

    @app.get("/admin", include_in_schema=False)
    async def admin_page():
        if not os.environ.get("ADMIN_TOKEN"):
            raise HTTPException(404)
        return FileResponse(Path(__file__).with_name("admin.html"), headers={"Cache-Control": "no-cache"})

    @app.get("/v1/admin/overview", dependencies=[Admin])
    async def admin_overview(svc: Svc):
        return await svc.admin_overview()

    @app.get("/v1/admin/users", dependencies=[Admin])
    async def admin_users(svc: Svc):
        return await svc.admin_users(await phones_by_user())

    @app.post("/v1/admin/codes", dependencies=[Admin])
    async def admin_code(body: PhoneIn, request: Request):
        """Код входа для пилота без SMS — как scripts/pilot_code, но кнопкой. Ссылка — адрес, с которого открыта админка."""
        phone, code = await app.state.auth.issue_manual(body.phone)
        link = os.environ.get("PUBLIC_URL") or str(request.base_url).rstrip("/")
        text = (f"Привет! Это Nutrivia — фото еды → калории и разбор от нутрициолога.\n"
                f"1. Открой ссылку в Safari или Chrome на телефоне: {link}\n"
                f"2. Чтобы было как приложение: «Поделиться» → «На экран Домой».\n"
                f"3. Введи свой номер и код входа: {code}\nКод одноразовый, действует 7 дней.")
        return {"phone": phone, "code": code, "message": text}

    @app.post("/v1/admin/operators", dependencies=[Admin])
    async def admin_operator(body: PhoneIn, svc: Svc):
        phone, status = await svc.make_operator(app.state.auth, body.phone)
        if status != "ok":
            raise AuthError(status, "У номера уже есть тренер или кабинет специалиста.", 409)
        return {"phone": phone}

    @app.get("/v1/admin/users.csv", dependencies=[Admin])
    async def admin_users_csv(svc: Svc):
        import csv
        import io
        from fastapi.responses import Response
        rows = await svc.admin_users(await phones_by_user())
        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=list(rows[0]) if rows else ["user_id"])
        w.writeheader()
        w.writerows(rows)
        return Response(buf.getvalue(), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": "attachment; filename=nutrivia-users.csv"})

    # Веб-версия приложения (WEB_DIR = результат `expo export -p web`): тот же адрес, что и API
    web_dir = os.environ.get("WEB_DIR")
    if web_dir and Path(web_dir, "index.html").is_file():
        root = Path(web_dir).resolve()

        @app.get("/{path:path}", include_in_schema=False)
        async def web_app(path: str):
            if path.startswith("v1/"):
                raise HTTPException(404)
            f = (root / path).resolve()
            if path and f.is_file() and f.is_relative_to(root):
                return FileResponse(f)
            # Маршруты приложения (/today, /meal…) — одна страница, роутер разберётся сам
            from fastapi.responses import HTMLResponse
            return HTMLResponse(index_html(), headers={"Cache-Control": "no-cache"})

        def index_html() -> str:
            """index.html экспорта + теги «как приложение» на экране «Домой» (PWA, iPhone)."""
            html = (root / "index.html").read_text(encoding="utf-8")
            if 'rel="manifest"' in html or not (root / "manifest.webmanifest").is_file():
                return html
            return html.replace("</head>", PWA_HEAD + "</head>", 1)

    return app


def main() -> None:
    import uvicorn
    logging.basicConfig(level=logging.INFO)
    uvicorn.run(create_app(), host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), proxy_headers=True)


if __name__ == "__main__":
    main()

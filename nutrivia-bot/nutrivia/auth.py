"""Вход в приложение по номеру телефона и коду из SMS.

- Код: 4 цифры, живёт 5 минут, 5 попыток ввода. В базе только HMAC-хеш кода.
- Повторная отправка не чаще раза в 60 секунд и не больше 5 раз в час на номер.
- Сессия: случайный токен 32 байта, в базе только его SHA-256, срок 90 дней.
- Отправка SMS — через SmsProvider: MobizonSms (Казахстан) или ConsoleSms (код в лог сервера, только для разработки).
- ManualCodes (пилот без SMS): код заранее выдаёт админ (scripts/pilot_code.py) и пересылает человеку сам.
  Живёт 7 дней, одноразовый; номер без выданного кода войти не может.
"""
import hashlib
import hmac
import logging
import re
import secrets

import httpx
from dataclasses import dataclass
from typing import Protocol

from .db import Database

log = logging.getLogger(__name__)

CODE_TTL = 5 * 60
MAX_ATTEMPTS = 5
RESEND_AFTER = 60
MAX_SENDS_PER_HOUR = 5
SESSION_TTL = 90 * 86400

AUTH_SCHEMA = """
CREATE TABLE IF NOT EXISTS sms_codes (
    phone TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    sent_at INTEGER NOT NULL,
    hour_start INTEGER NOT NULL,
    hour_sends INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS app_accounts (
    phone TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
"""


class SmsProvider(Protocol):
    async def send(self, phone: str, text: str) -> None: ...


class ConsoleSms:
    """Для разработки: SMS не уходит, код пишется в лог сервера."""

    def __init__(self):
        self.sent: list[tuple[str, str]] = []

    async def send(self, phone: str, text: str) -> None:
        self.sent.append((phone, text))
        log.warning("DEV SMS to %s: %s", phone, text)


class ManualCodes:
    """Пилот без SMS: коды не отправляются, их выдаёт админ через SmsAuth.issue_manual."""

    manual = True

    async def send(self, phone: str, text: str) -> None:
        raise SmsError("manual mode: codes are issued by admin")


MANUAL_CODE_TTL = 7 * 86400


class SmsError(Exception):
    pass


class MobizonSms:
    """mobizon.kz. Без SMS_FROM уходит с общего отправителя Mobizon; своё альфа-имя регистрируется у них отдельно."""

    def __init__(self, api_key: str, sender: str = "", host: str = "api.mobizon.kz",
                 client: httpx.AsyncClient | None = None):
        self.api_key, self.sender, self.host = api_key, sender, host
        self.client = client or httpx.AsyncClient(timeout=15)

    async def send(self, phone: str, text: str) -> None:
        data = {"recipient": phone.lstrip("+"), "text": text, "params[validity]": "10"}
        if self.sender:
            data["from"] = self.sender
        try:
            resp = await self.client.post(f"https://{self.host}/service/message/sendSmsMessage",
                                          params={"output": "json", "api": "v1", "apiKey": self.api_key}, data=data)
            out = resp.json()
        except (httpx.HTTPError, ValueError) as e:
            raise SmsError(f"mobizon: {e}") from e
        if out.get("code") != 0:
            raise SmsError(f"mobizon code {out.get('code')}: {out.get('message')} {out.get('data')}")


class AuthError(Exception):
    """code — машинный код ошибки для приложения, message — текст для человека."""

    def __init__(self, code: str, message: str, status: int = 400, retry_after: int | None = None):
        super().__init__(message)
        self.code, self.message, self.status, self.retry_after = code, message, status, retry_after


_KZ_MOBILE = re.compile(r"^7(7\d{9})$")


def normalize_phone(raw: str) -> str:
    """«8 707 123 45 67», «+7 (707) 123-45-67» → «+77071234567». Пока только казахстанские мобильные (+7 7xx)."""
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 11 and digits[0] == "8":
        digits = "7" + digits[1:]
    if len(digits) == 10 and digits[0] == "7":
        digits = "7" + digits
    if not _KZ_MOBILE.match(digits):
        raise AuthError("bad_phone", "Введите казахстанский мобильный номер: +7 7XX XXX XX XX")
    return "+" + digits


@dataclass
class Session:
    user_id: int
    token_hash: str


class SmsAuth:
    def __init__(self, db: Database, sms: SmsProvider, secret: str):
        self.db, self.sms, self.secret = db, sms, secret.encode()

    async def init(self) -> None:
        await self.db.conn.executescript(AUTH_SCHEMA)
        await self.db.conn.commit()

    def _code_hash(self, phone: str, code: str) -> str:
        return hmac.new(self.secret, f"{phone}:{code}".encode(), hashlib.sha256).hexdigest()

    @staticmethod
    def _token_hash(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    async def start(self, raw_phone: str) -> dict:
        phone = normalize_phone(raw_phone)
        now = self.db.clock()
        row = await self.db.fetchone("SELECT * FROM sms_codes WHERE phone = ?", (phone,))
        if getattr(self.sms, "manual", False):
            # Код уже выдан админом — ничего не шлём, просто пускаем на экран ввода
            if row and row["expires_at"] >= now and row["attempts"] < MAX_ATTEMPTS:
                return {"phone": phone, "resend_after": 0, "expires_in": row["expires_at"] - now, "delivery": "manual"}
            raise AuthError("not_invited", "Для этого номера нет кода. Напишите команде Nutrivia — пришлём код в WhatsApp.", 403)
        hour_start, hour_sends = now, 1
        if row:
            wait = row["sent_at"] + RESEND_AFTER - now
            if wait > 0:
                raise AuthError("too_soon", "Код уже отправлен. Повторно — через минуту.", 429, wait)
            if now - row["hour_start"] < 3600:
                if row["hour_sends"] >= MAX_SENDS_PER_HOUR:
                    raise AuthError("too_many", "Слишком много попыток. Попробуйте через час.", 429,
                                    row["hour_start"] + 3600 - now)
                hour_start, hour_sends = row["hour_start"], row["hour_sends"] + 1
        code = f"{secrets.randbelow(10_000):04d}"
        await self.db.execute(
            "INSERT OR REPLACE INTO sms_codes (phone, code_hash, expires_at, attempts, sent_at, hour_start, hour_sends)"
            " VALUES (?, ?, ?, 0, ?, ?, ?)",
            (phone, self._code_hash(phone, code), now + CODE_TTL, now, hour_start, hour_sends))
        try:
            await self.sms.send(phone, f"Nutrivia: код входа {code}. Никому его не сообщайте.")
        except SmsError as e:
            # Код не дошёл — не держим человека минуту до повторной отправки
            log.error("sms failed for *%s: %s", phone[-4:], e)
            await self.db.execute("DELETE FROM sms_codes WHERE phone = ?", (phone,))
            raise AuthError("sms_failed", "Не получилось отправить SMS. Попробуйте ещё раз.", 502)
        await self.db.log_event("sms_sent", None, phone_tail=phone[-4:])
        return {"phone": phone, "resend_after": RESEND_AFTER, "expires_in": CODE_TTL, "delivery": "sms"}

    async def issue_manual(self, raw_phone: str, ttl: int = MANUAL_CODE_TTL) -> tuple[str, str]:
        """Админ выдаёт код для пилота без SMS. Новый код заменяет прежний. Возвращает (номер, код)."""
        phone = normalize_phone(raw_phone)
        now = self.db.clock()
        code = f"{secrets.randbelow(10_000):04d}"
        await self.db.execute(
            "INSERT OR REPLACE INTO sms_codes (phone, code_hash, expires_at, attempts, sent_at, hour_start, hour_sends)"
            " VALUES (?, ?, ?, 0, ?, ?, 0)",
            (phone, self._code_hash(phone, code), now + ttl, now, now))
        await self.db.log_event("code_issued", None, phone_tail=phone[-4:])
        return phone, code

    async def verify(self, raw_phone: str, code: str) -> str:
        """Проверяет код. Возвращает нормализованный номер; одноразовый код после успеха удаляется."""
        phone = normalize_phone(raw_phone)
        now = self.db.clock()
        row = await self.db.fetchone("SELECT * FROM sms_codes WHERE phone = ?", (phone,))
        if row is None or row["expires_at"] < now:
            raise AuthError("expired", "Код устарел. Запросите новый.", 400)
        if row["attempts"] >= MAX_ATTEMPTS:
            raise AuthError("locked", "Слишком много неверных попыток. Запросите новый код.", 429)
        if not hmac.compare_digest(row["code_hash"], self._code_hash(phone, (code or "").strip())):
            await self.db.execute("UPDATE sms_codes SET attempts = attempts + 1 WHERE phone = ?", (phone,))
            left = MAX_ATTEMPTS - row["attempts"] - 1
            raise AuthError("wrong_code", f"Неверный код. Осталось попыток: {left}." if left else
                            "Неверный код. Запросите новый.", 400)
        await self.db.execute("DELETE FROM sms_codes WHERE phone = ?", (phone,))
        return phone

    async def user_for_phone(self, phone: str) -> int | None:
        row = await self.db.fetchone("SELECT user_id FROM app_accounts WHERE phone = ?", (phone,))
        return row["user_id"] if row else None

    async def link(self, phone: str, user_id: int) -> None:
        await self.db.execute("INSERT INTO app_accounts (phone, user_id) VALUES (?, ?)", (phone, user_id))

    async def issue(self, user_id: int) -> str:
        token = secrets.token_urlsafe(32)
        now = self.db.clock()
        await self.db.execute("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                              (self._token_hash(token), user_id, now, now + SESSION_TTL))
        return token

    async def session(self, token: str) -> Session | None:
        h = self._token_hash(token)
        row = await self.db.fetchone("SELECT * FROM sessions WHERE token_hash = ?", (h,))
        if row is None or row["expires_at"] < self.db.clock():
            return None
        return Session(row["user_id"], h)

    async def revoke(self, token_hash: str) -> None:
        await self.db.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))

    async def forget_user(self, user_id: int) -> None:
        """Удаление аккаунта: номер телефона и все сессии."""
        await self.db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        await self.db.execute("DELETE FROM app_accounts WHERE user_id = ?", (user_id,))

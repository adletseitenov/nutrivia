"""SQLite-хранилище бота. Таблицы повторяют модель данных MVP в упрощённом виде,
чтобы в M1 их можно было перенести в Postgres без переосмысления."""
import json
import time
from datetime import datetime
from pathlib import Path

import aiosqlite

from .config import ALMATY

SCHEMA = """
CREATE TABLE IF NOT EXISTS coaches (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    review_chat_id INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
    tg_id INTEGER PRIMARY KEY,
    lang TEXT NOT NULL DEFAULT 'ru',
    grp TEXT NOT NULL,                 -- coach | solo
    coach_code TEXT,
    joined_at INTEGER NOT NULL,
    consent_at INTEGER,
    goal TEXT,
    restrictions TEXT,
    kcal_target INTEGER,
    state TEXT,                        -- ожидаемый ввод: restrictions | correction:<meal_id>
    offered_at INTEGER,
    paid_at INTEGER,
    channel TEXT NOT NULL DEFAULT 'telegram',  -- telegram | app
    role TEXT NOT NULL DEFAULT 'client'        -- client | trainer | nutritionist
);
CREATE TABLE IF NOT EXISTS pros (
    user_id INTEGER PRIMARY KEY,        -- тренер или нутрициолог из приложения
    code TEXT UNIQUE NOT NULL           -- код приглашения = coaches.code
);
CREATE TABLE IF NOT EXISTS meals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    photo_path TEXT,
    received_at INTEGER NOT NULL,
    draft_at INTEGER,
    status TEXT NOT NULL DEFAULT 'received',  -- received | draft | sent | confirmed | corrected | failed
    review_chat_id INTEGER,
    review_msg_id INTEGER,
    reviewer_id INTEGER,
    reviewed_at INTEGER,
    sent_at INTEGER,
    comment TEXT,
    ai_draft TEXT                      -- исходный ответ модели (JSON) для замера ошибки граммов
);
CREATE TABLE IF NOT EXISTS meal_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meal_id INTEGER NOT NULL,
    raw_name TEXT NOT NULL,
    dish_id TEXT,
    portion TEXT,
    grams REAL NOT NULL,
    ai_grams REAL,
    kcal REAL, protein REAL, fat REAL, carbs REAL
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    user_id INTEGER,
    name TEXT NOT NULL,
    data TEXT
);
CREATE TABLE IF NOT EXISTS ai_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    user_id INTEGER,
    meal_id INTEGER,
    model TEXT,
    status TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_usd REAL,
    latency_ms INTEGER,
    error TEXT
);
CREATE TABLE IF NOT EXISTS jobs_done (
    key TEXT PRIMARY KEY,
    ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meals_user ON meals(user_id, received_at);
CREATE INDEX IF NOT EXISTS idx_events_name ON events(name, ts);
"""


def now() -> int:
    return int(time.time())


def local_day_bounds(ts: int | None = None, days_back: int = 0) -> tuple[int, int]:
    """Начало и конец суток по Алматы, сдвинутые на days_back дней назад."""
    dt = datetime.fromtimestamp(ts if ts is not None else now(), ALMATY)
    start = dt.replace(hour=0, minute=0, second=0, microsecond=0)
    start_ts = int(start.timestamp()) - days_back * 86400
    return start_ts, start_ts + 86400


class Database:
    def __init__(self, path: str):
        self.path = path
        self.conn: aiosqlite.Connection | None = None
        self.clock = now  # подменяется в офлайн-прогоне

    async def connect(self) -> None:
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = await aiosqlite.connect(self.path)
        self.conn.row_factory = aiosqlite.Row
        await self.conn.executescript(SCHEMA)
        cols = {r[1] for r in await (await self.conn.execute("PRAGMA table_info(users)")).fetchall()}
        if "channel" not in cols:  # БД, созданная до появления приложения
            await self.conn.execute("ALTER TABLE users ADD COLUMN channel TEXT NOT NULL DEFAULT 'telegram'")
        if "role" not in cols:  # client | trainer | nutritionist
            await self.conn.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'client'")
        await self.conn.commit()

    async def close(self) -> None:
        if self.conn:
            await self.conn.close()

    async def execute(self, sql: str, params: tuple = ()) -> int:
        cur = await self.conn.execute(sql, params)
        await self.conn.commit()
        return cur.lastrowid

    async def fetchone(self, sql: str, params: tuple = ()) -> aiosqlite.Row | None:
        cur = await self.conn.execute(sql, params)
        return await cur.fetchone()

    async def fetchall(self, sql: str, params: tuple = ()) -> list[aiosqlite.Row]:
        cur = await self.conn.execute(sql, params)
        return list(await cur.fetchall())

    # --- события ---
    async def log_event(self, name: str, user_id: int | None = None, **data) -> None:
        await self.execute(
            "INSERT INTO events (ts, user_id, name, data) VALUES (?, ?, ?, ?)",
            (self.clock(), user_id, name, json.dumps(data, ensure_ascii=False) if data else None),
        )

    # --- пользователи ---
    async def get_user(self, tg_id: int):
        return await self.fetchone("SELECT * FROM users WHERE tg_id = ?", (tg_id,))

    async def update_user(self, tg_id: int, **fields) -> None:
        cols = ", ".join(f"{k} = ?" for k in fields)
        await self.execute(f"UPDATE users SET {cols} WHERE tg_id = ?", (*fields.values(), tg_id))

    async def get_coach(self, code: str | None):
        if not code:
            return None
        return await self.fetchone("SELECT * FROM coaches WHERE code = ?", (code,))

    async def delete_user(self, tg_id: int) -> list[str]:
        """Удаляет все данные пользователя; возвращает пути фото для удаления с диска.
        Событие deleted остаётся без персональных данных — нужно для метрик."""
        rows = await self.fetchall("SELECT id, photo_path FROM meals WHERE user_id = ?", (tg_id,))
        ids = [r["id"] for r in rows]
        if ids:
            marks = ",".join("?" * len(ids))
            await self.execute(f"DELETE FROM meal_items WHERE meal_id IN ({marks})", tuple(ids))
        await self.execute("DELETE FROM meals WHERE user_id = ?", (tg_id,))
        await self.execute("DELETE FROM users WHERE tg_id = ?", (tg_id,))
        # специалист: ученики остаются, но отвязываются; код приглашения перестаёт работать
        pro = await self.fetchone("SELECT code FROM pros WHERE user_id = ?", (tg_id,))
        if pro:
            await self.execute("UPDATE users SET coach_code = NULL, grp = 'solo' WHERE coach_code = ?", (pro["code"],))
            await self.execute("DELETE FROM coaches WHERE code = ?", (pro["code"],))
            await self.execute("DELETE FROM pros WHERE user_id = ?", (tg_id,))
        await self.execute("UPDATE events SET data = NULL WHERE user_id = ?", (tg_id,))
        return [r["photo_path"] for r in rows if r["photo_path"]]

    # --- приёмы пищи ---
    async def meal_items(self, meal_id: int):
        return await self.fetchall("SELECT * FROM meal_items WHERE meal_id = ? ORDER BY id", (meal_id,))

    async def replace_items(self, meal_id: int, items: list[dict]) -> None:
        await self.execute("DELETE FROM meal_items WHERE meal_id = ?", (meal_id,))
        for it in items:
            await self.execute(
                "INSERT INTO meal_items (meal_id, raw_name, dish_id, portion, grams, ai_grams, kcal, protein, fat, carbs)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (meal_id, it["raw_name"], it.get("dish_id"), it.get("portion"), it["grams"], it.get("ai_grams"),
                 it.get("kcal"), it.get("protein"), it.get("fat"), it.get("carbs")),
            )

    async def day_totals(self, user_id: int, start: int, end: int) -> dict:
        """КБЖУ за период только по разборам, которые ушли клиенту."""
        row = await self.fetchone(
            "SELECT COUNT(DISTINCT m.id) AS meals, COALESCE(SUM(i.kcal),0) AS kcal, COALESCE(SUM(i.protein),0) AS protein,"
            " COALESCE(SUM(i.fat),0) AS fat, COALESCE(SUM(i.carbs),0) AS carbs"
            " FROM meals m JOIN meal_items i ON i.meal_id = m.id"
            " WHERE m.user_id = ? AND m.received_at >= ? AND m.received_at < ?"
            " AND m.status IN ('sent','confirmed','corrected')",
            (user_id, start, end),
        )
        return dict(row)

    # --- задания по расписанию (идемпотентность) ---
    async def job_once(self, key: str) -> bool:
        """True, если задание с таким ключом ещё не выполнялось (и помечает его)."""
        try:
            await self.execute("INSERT INTO jobs_done (key, ts) VALUES (?, ?)", (key, self.clock()))
            return True
        except aiosqlite.IntegrityError:
            return False
